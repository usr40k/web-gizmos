#!/usr/bin/env python3
"""
Mega Miner NG - Persistent Hosted Multiplayer Server
=====================================================
A WebSocket-based dedicated server for Mega Miner NG that provides:
  - Account system (register/login with hashed passwords)
  - Persistent world storage (autosave) - stores only diffs from procedural
  - Single world name (configured, not arbitrary rooms)
  - Map state synchronization via procedural seed + diffs
  - Built-in dummy client for admin functions (explosions, falling blocks, etc.)
  - Full admin/gamemaster controls
  - Chat, trade, explosion, and tile update relay
  - Manual user definitions in config (disables registration if desired)
"""

import asyncio
import json
import os
import sys
import time
import hashlib
import secrets
import uuid
import signal
import argparse
import math
from datetime import datetime, timezone

try:
    import websockets
except ImportError:
    print("ERROR: websockets library not found. Install with: pip install websockets")
    sys.exit(1)

# ============================================================================
# CONFIGURATION
# ============================================================================

DEFAULT_CONFIG = {
    "server": {
        "host": "0.0.0.0",
        "port": 4242,
        "max_players": 50,
        "heartbeat_timeout": 15,
        "autosave_interval": 60,
        "log_level": "info",
        "world_name": "default-world"  # Single world name for this server
    },
    "ssl": {
        "enabled": False,
        "certfile": "server.crt",
        "keyfile": "server.key"
    },
    "game": {
        "map_width": 1000,
        "map_height": 2000,
        "tile_size": 32,
        "speed_normal": 1.75,
        "speed_drill": 0.75,
        "fuel_consumption": 0.125,
        "max_fuel": 100,
        "max_hull": 100,
        "max_cargo": 50
    },
    "accounts": {
        "allow_registration": True,
        "allow_guests": True,
        "min_username_length": 3,
        "max_username_length": 16,
        "min_password_length": 4,
        "users": {
            # Example - pre-defined users that bypass registration:
            # "admin": "secure_password"
        }
    },
    "paths": {
        "data_directory": "server_data",
        "worlds_directory": "server_data/worlds",
        "accounts_file": "server_data/accounts.json"
    }
}


def load_config(config_path="server_config.json"):
    """Load config from file or create default."""
    config = DEFAULT_CONFIG.copy()
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                user_config = json.load(f)
            # Deep merge
            for section, values in user_config.items():
                if section in config:
                    config[section].update(values)
                else:
                    config[section] = values
        except Exception as e:
            print(f"Warning: Could not load config: {e}")
    else:
        # Write default config
        try:
            with open(config_path, 'w') as f:
                json.dump(config, f, indent=4)
            print(f"Created default config: {config_path}")
        except Exception as e:
            print(f"Warning: Could not write default config: {e}")
    return config


# ============================================================================
# DATA STORAGE
# ============================================================================

class AccountManager:
    """Handles user accounts with hashed passwords."""

    def __init__(self, accounts_path, config):
        self.accounts_path = accounts_path
        self.config = config
        self.accounts = {}  # username -> { password_hash, salt, created_at, last_login, banned }
        self.sessions = {}  # token -> username
        self.sessions_path = accounts_path.replace('.json', '_sessions.json')
        self._ensure_directory()
        self._load()
        self._load_sessions()
        self._load_manual_users()

    def _ensure_directory(self):
        directory = os.path.dirname(self.accounts_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

    def _load(self):
        if os.path.exists(self.accounts_path):
            try:
                with open(self.accounts_path, 'r') as f:
                    self.accounts = json.load(f)
                print(f"Loaded {len(self.accounts)} accounts from {self.accounts_path}")
            except Exception as e:
                print(f"Warning: Could not load accounts: {e}")

    def _save(self):
        try:
            self._ensure_directory()
            with open(self.accounts_path, 'w') as f:
                json.dump(self.accounts, f, indent=2)
        except Exception as e:
            print(f"Error saving accounts: {e}")

    def _load_sessions(self):
        """Load persisted sessions from disk so tokens survive server restarts."""
        if os.path.exists(self.sessions_path):
            try:
                with open(self.sessions_path, 'r') as f:
                    self.sessions = json.load(f)
                print(f"Loaded {len(self.sessions)} sessions from {self.sessions_path}")
            except Exception as e:
                print(f"Warning: Could not load sessions: {e}")
                self.sessions = {}

    def _save_sessions(self):
        """Persist sessions to disk."""
        try:
            self._ensure_directory()
            with open(self.sessions_path, 'w') as f:
                json.dump(self.sessions, f, indent=2)
        except Exception as e:
            print(f"Error saving sessions: {e}")

    def _load_manual_users(self):
        """Load manually-defined users from config."""
        manual_users = self.config.get('accounts', {}).get('users', {})
        if not manual_users:
            return

        added = 0
        for username, password in manual_users.items():
            username = username.strip()
            if username in self.accounts:
                # Update existing account's password
                pw_hash, salt = self._hash_password(password)
                self.accounts[username]["password_hash"] = pw_hash
                self.accounts[username]["salt"] = salt
                self.accounts[username]["is_manual"] = True
                print(f"[Accounts] Updated password for manual user '{username}'")
            else:
                # Create new account
                pw_hash, salt = self._hash_password(password)
                self.accounts[username] = {
                    "password_hash": pw_hash,
                    "salt": salt,
                    "created_at": time.time(),
                    "last_login": None,
                    "banned": False,
                    "is_manual": True
                }
                print(f"[Accounts] Created manual user '{username}'")
            added += 1

        if added > 0:
            self._save()
            print(f"[Accounts] Processed {added} manual user(s) from config")

    def _hash_password(self, password, salt=None):
        if salt is None:
            salt = secrets.token_hex(16)
        # Use SHA-256 with salt
        h = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
        return h, salt

    def register(self, username, password):
        """Register a new account. Returns (success, message)."""
        username = username.strip()
        min_username = self.config['accounts']['min_username_length']
        max_username = self.config['accounts']['max_username_length']
        min_password = self.config['accounts']['min_password_length']

        if len(username) < min_username:
            return False, f"Username must be at least {min_username} characters"
        if len(username) > max_username:
            return False, f"Username must be at most {max_username} characters"
        if len(password) < min_password:
            return False, f"Password must be at least {min_password} characters"
        if username.lower() in [a.lower() for a in self.accounts]:
            return False, "Username already taken"
        if not username.isalnum() and '_' not in username:
            return False, "Username can only contain letters, numbers, and underscores"

        pw_hash, salt = self._hash_password(password)
        self.accounts[username] = {
            "password_hash": pw_hash,
            "salt": salt,
            "created_at": time.time(),
            "last_login": None,
            "banned": False
        }
        self._save()
        return True, "Account created successfully"

    def login(self, username, password):
        """Login and return a session token. Returns (success, message, token)."""
        username = username.strip()
        account = self.accounts.get(username)
        if not account:
            return False, "Invalid username or password", None
        if account.get("banned"):
            return False, "This account has been banned", None

        pw_hash, _ = self._hash_password(password, account["salt"])
        if pw_hash != account["password_hash"]:
            return False, "Invalid username or password", None

        token = secrets.token_hex(32)
        self.sessions[token] = username
        account["last_login"] = time.time()
        self._save()
        self._save_sessions()
        return True, "Login successful", token

    def validate_session(self, token):
        """Validate a session token. Returns username or None."""
        return self.sessions.get(token)

    def logout(self, token):
        """Remove a session token."""
        self.sessions.pop(token, None)

    def is_banned(self, username):
        account = self.accounts.get(username)
        return account and account.get("banned", False)

    def ban_user(self, username):
        account = self.accounts.get(username)
        if account:
            account["banned"] = True
            self._save()
            return True
        return False

    def unban_user(self, username):
        account = self.accounts.get(username)
        if account:
            account["banned"] = False
            self._save()
            return True
        return False

    def get_account_count(self):
        """Return the number of registered accounts."""
        return len(self.accounts)


# ============================================================================
# PROCEDURAL TERRAIN (matches client algorithm)
# ============================================================================

def procedural_tile(x, y, seed, mw, mh):
    """Match the client's getProceduralTile algorithm exactly."""
    if y < 5:
        return 0  # EMPTY
    if y == 5:
        return 2  # GRASS
    if y >= mh - 1:
        return 99  # BEDROCK

    # Determine base type
    if y > 300:
        base = 5  # DEEP_SLATE
    elif y > 100:
        base = 4  # HARD_STONE
    elif y > 30:
        base = 3  # STONE
    else:
        base = 1  # DIRT

    # Seeded random - match client algorithm using sin-based hash
    s = math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453
    r = s - math.floor(s)

    # Rare ores (Ruby, Emerald, Diamond) - now rarer / more sparse
    if r > 0.994:
        s2 = math.sin(x * 12.9898 + (y + 10000) * 78.233 + seed) * 43758.5453
        ore_roll = s2 - math.floor(s2)
        if y > 400 and ore_roll < 0.2:
            return 11  # RUBY
        elif y > 250 and ore_roll < 0.6:
            return 10  # EMERALD
        elif y > 150:
            return 9  # DIAMOND
    if r > 0.9999:
        return 67  # RICK

    # Standard (scattered) Ores - MUCH sparser than before.
    # Most minerals now show up in veins below instead of scattered singles.
    if r > 0.99 and y > 100:
        return 8  # GOLD
    if r > 0.982 and y > 50:
        return 7  # IRON
    if r > 0.972:
        return 6  # COAL

    # ORE VEINS - dense clusters seeded in coarse cells.
    # Mirrors client getVeinHash() / getVeinOre() exactly.
    V = 12
    cx = x // V
    cy = y // V
    half = V / 2.0
    dxc = (x - (cx * V + half)) / half
    dyc = (y - (cy * V + half)) / half
    focus = max(0.0, 1.0 - math.hypot(dxc, dyc))  # 1 center, 0 edges

    sv = math.sin(cx * 3.7 + cy * 19.1 + seed) * 43758.5453
    vr = sv - math.floor(sv)

    ore = 0
    if y > 100:
        if vr > 0.955:
            ore = 8  # GOLD
        elif vr > 0.90:
            ore = 7  # IRON
        elif vr > 0.82:
            ore = 6  # COAL
    elif y > 50:
        if vr > 0.90:
            ore = 7  # IRON
        elif vr > 0.80:
            ore = 6  # COAL
    else:
        if vr > 0.82:
            ore = 6  # COAL
    if ore:
        s3 = math.sin(x * 12.9898 + (y + 30000) * 78.233 + seed) * 43758.5453
        tv = s3 - math.floor(s3)
        density = (0.08 + 0.92 * focus * focus) * (0.6 if ore == 8 else 1.0)
        if tv < density:
            return ore

    return base


class WorldManager:
    """Handles persistent world data with autosaving.
    
    Only stores diffs (changes from procedural generation) to keep
    save files small and map sync fast.
    """

    def __init__(self, worlds_directory, mw, mh):
        self.worlds_directory = worlds_directory
        self.mw = mw
        self.mh = mh
        self.worlds = {}  # world_name -> { diffs, player_data, metadata }
        self._ensure_directory()

    def _ensure_directory(self):
        os.makedirs(self.worlds_directory, exist_ok=True)

    def _world_path(self, world_name):
        safe_name = "".join(c if c.isalnum() or c in '_-' else '_' for c in world_name)
        return os.path.join(self.worlds_directory, f"world_{safe_name}.json")

    def load_world(self, world_name):
        """Load a world from disk, or create a new one."""
        if world_name in self.worlds:
            print(f"[Load] World '{world_name}' already in memory")
            return self.worlds[world_name]

        path = self._world_path(world_name)
        print(f"[Load] Attempting to load world '{world_name}' from {path}")
        print(f"[Load] File exists: {os.path.exists(path)}")
        
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                self.worlds[world_name] = data
                diffs_count = len(data.get('diffs', []))
                players_count = len(data.get('player_data', {}))
                print(f"[Load] Successfully loaded world '{world_name}' ({diffs_count} diffs, {players_count} players)")
                return data
            except Exception as e:
                print(f"[Load] Error loading world '{world_name}': {e}")

        # Create new world
        world = {
            "world_name": world_name,
            "created_at": time.time(),
            "last_save": time.time(),
            "diffs": [],  # List of [x, y, value] - only tiles changed from procedural
            "player_data": {},  # username -> { money, drillTier, maxHull, maxFuel, etc }
            "banned_ids": [],
            "procedural_seed": abs(hash(world_name)) % (2**31)
        }
        self.worlds[world_name] = world
        print(f"[Load] Created new world '{world_name}' (seed: {world['procedural_seed']})")
        return world

    def get_tile(self, world, x, y):
        """Get tile value at (x,y), checking diffs first then procedural."""
        # Check diffs first
        for dx, dy, val in world.get('diffs', []):
            if dx == x and dy == y:
                return val
        # Fall back to procedural
        return procedural_tile(x, y, world['procedural_seed'], self.mw, self.mh)

    def update_tile(self, world_name, x, y, value):
        """Update a single tile. Stores as a diff from procedural."""
        world = self.worlds.get(world_name)
        if not world:
            return False
        if y < 0 or y >= self.mh or x < 0 or x >= self.mw:
            return False
        
        # Check if this tile matches procedural (if so, remove from diffs)
        base = procedural_tile(x, y, world['procedural_seed'], self.mw, self.mh)
        if value == base:
            # Remove from diffs if present
            world['diffs'] = [d for d in world['diffs'] if not (d[0] == x and d[1] == y)]
        else:
            # Add or update diff
            for i, (dx, dy, _) in enumerate(world['diffs']):
                if dx == x and dy == y:
                    world['diffs'][i][2] = value
                    break
            else:
                world['diffs'].append([x, y, value])
        return True

    def apply_diff(self, world_name, diffs):
        """Apply a batch of tile updates. diffs is a list of [x, y, value]."""
        world = self.worlds.get(world_name)
        if not world:
            return []
        failed = []
        for x, y, val in diffs:
            if 0 <= y < self.mh and 0 <= x < self.mw:
                self.update_tile(world_name, x, y, val)
            else:
                failed.append((x, y, val))
        return failed

    def get_area_diff(self, world_name, bx, by, bw, bh):
        """Get diffs for a region that differ from procedural."""
        world = self.worlds.get(world_name)
        if not world:
            return []
        # Filter diffs to the requested area
        result = []
        for x, y, val in world.get('diffs', []):
            if bx <= x < bx + bw and by <= y < by + bh:
                result.append([x, y, val])
        return result

    def get_all_diffs(self, world_name):
        """Get all diffs for full map sync."""
        world = self.worlds.get(world_name)
        if not world:
            return []
        return world.get('diffs', [])

    def save_world(self, world_name, world_obj=None):
        """Save a world to disk.
        
        Args:
            world_name: Name of the world
            world_obj: Optional world object to save (avoids lookup issues)
        """
        # Use provided world object or look it up
        if world_obj is None:
            world_obj = self.worlds.get(world_name)
        
        if not world_obj:
            print(f"[Save] World '{world_name}' not found")
            return False
        
        world_obj['last_save'] = time.time()
        path = self._world_path(world_name)
        try:
            self._ensure_directory()
            diffs_count = len(world_obj.get('diffs', []))
            players_count = len(world_obj.get('player_data', {}))
            print(f"[Save] Saving world '{world_name}' to {path} ({diffs_count} diffs, {players_count} players)")
            with open(path, 'w') as f:
                json.dump(world_obj, f, indent=2)
            print(f"[Save] Successfully saved world '{world_name}'")
            return True
        except Exception as e:
            print(f"[Save] Error saving world '{world_name}': {e}")
            return False

    def save_all(self):
        """Save all loaded worlds."""
        for world_name in list(self.worlds.keys()):
            self.save_world(world_name)


# ============================================================================
# ROOM / CHANNEL MANAGER
# ============================================================================

class Room:
    """A game room containing connected players and world state."""

    def __init__(self, room_id, world_manager, config):
        self.room_id = room_id
        self.world = world_manager.load_world(room_id)
        self.world_manager = world_manager
        self.config = config
        self.players = {}  # username -> PlayerState
        self.admin = None  # username of admin (first to join)
        self.last_activity = time.time()
        self.next_autosave = time.time() + config['server']['autosave_interval']

    @property
    def player_count(self):
        return len(self.players)


class PlayerState:
    """Represents a connected player's state."""

    def __init__(self, websocket, username, account_token=None):
        self.websocket = websocket
        self.username = username
        self.account_token = account_token
        self.player_id = str(uuid.uuid4())
        self.joined_at = time.time()
        self.last_heartbeat = time.time()

        # Game state - matches localPlayer on client
        self.grid_x = DEFAULT_CONFIG['game']['map_width'] // 2
        self.grid_y = 4
        self.x = self.grid_x * DEFAULT_CONFIG['game']['tile_size']
        self.y = self.grid_y * DEFAULT_CONFIG['game']['tile_size']
        self.fuel = DEFAULT_CONFIG['game']['max_fuel']
        self.max_fuel = DEFAULT_CONFIG['game']['max_fuel']
        self.hull = DEFAULT_CONFIG['game']['max_hull']
        self.max_hull = DEFAULT_CONFIG['game']['max_hull']
        self.cargo = 0
        self.max_cargo = DEFAULT_CONFIG['game']['max_cargo']
        self.money = 0
        self.rotation = 0
        self.is_drilling = False
        self.drill_tier = 0
        self.heat_resist = 0
        self.xray_range = 3
        self.multi_mine = 0
        self.inventory = {}
        self.color = '#3498db'
        self.selected_block = 20  # CASING
        self.stats = {"blocksMined": {}, "totalMined": 0, "startTime": time.time()}
        self.teleporters = []
        self.blueprints = []
        self.achievements = {}

    def to_dict(self):
        return {
            "id": self.player_id,
            "username": self.username,
            "color": self.color,
            "joinedAt": int(self.joined_at * 1000),
            "lastSeen": int(self.last_heartbeat * 1000)
        }

    def to_move_packet(self):
        return {
            "type": "move",
            "id": self.player_id,
            "username": self.username,
            "col": self.color,
            "joinedAt": int(self.joined_at * 1000),
            "sx": self.x,
            "sy": self.y,
            "tx": self.grid_x * DEFAULT_CONFIG['game']['tile_size'],
            "ty": self.grid_y * DEFAULT_CONFIG['game']['tile_size'],
            "gx": self.grid_x,
            "gy": self.grid_y,
            "r": self.rotation,
            "drill": self.is_drilling,
            "isAdmin": False  # Set by room
        }


# ============================================================================
# DUMMY CLIENT - Handles admin functions on the server
# ============================================================================

class DummyClient:
    """A virtual client that runs on the server to handle admin functions.
    
    In the original design, the first player to join becomes "admin" and
    handles game logic like explosions, falling blocks, random events, etc.
    This dummy client takes over those responsibilities so the server is
    fully self-sufficient.
    """
    
    def __init__(self, server):
        self.server = server
        self.player_id = "__server__"
        self.username = "__SERVER__"
        self.joined_at = time.time()
        self.last_heartbeat = time.time()
        self.explosives = []  # Track active TNT/Nuke timers
        self.last_random_event = 0
        
    async def update(self, room_id):
        """Called periodically to handle server-side game logic."""
        room = self.server.rooms.get(room_id)
        if not room:
            return
            
        now_time = time.time() * 1000  # ms
        
        # 1. Handle explosive timers
        for i in range(len(self.explosives) - 1, -1, -1):
            e = self.explosives[i]
            if not e.get('sent'):
                # Broadcast explosion to all players
                await self.server.broadcast_to_room(room_id, {
                    "type": "explode",
                    "id": self.player_id,
                    "x": e['x'],
                    "y": e['y'],
                    "r": e['range'],
                    "t": e['timer']
                })
                e['sent'] = True
                e['done_at'] = now_time + e['timer']
            if now_time >= e.get('done_at', 0):
                # Apply explosion to world
                self._apply_explosion(room, e['x'], e['y'], e['range'])
                self.explosives.pop(i)
        
        # 2. Handle falling blocks (Gravel/Sand) near players
        await self._update_falling_blocks(room)
        
        # 3. Random events (every ~30 seconds)
        if now_time - self.last_random_event > 30000:
            self.last_random_event = now_time
            # Only trigger if there are players underground
            for username, player in room.players.items():
                if player.grid_y > 10:
                    await self._trigger_random_event(room)
                    break
    
    def add_explosive(self, x, y, range_val, timer):
        """Register an explosive placed by a player."""
        self.explosives.append({
            'x': x, 'y': y, 'range': range_val, 'timer': timer,
            'sent': False, 'placed_at': time.time() * 1000
        })
    
    def _apply_explosion(self, room, cx, cy, radius):
        """Apply explosion effects to the world."""
        mw = DEFAULT_CONFIG['game']['map_width']
        mh = DEFAULT_CONFIG['game']['map_height']
        wm = self.server.worlds
        need_save = False
        
        for y in range(cy - radius, cy + radius + 1):
            for x in range(cx - radius, cx + radius + 1):
                if y > 4 and 0 <= x < mw and 0 <= y < mh:
                    if math.sqrt((x - cx)**2 + (y - cy)**2) <= radius:
                        tile = wm.get_tile(room.world, x, y)
                        if tile != 99:  # Not bedrock
                            wm.update_tile(room.room_id, x, y, 0)  # EMPTY
                            need_save = True
        
        # Save world after explosion changes
        if need_save:
            wm.save_world(room.room_id, room.world)
    
    async def _update_falling_blocks(self, room):
        """Update falling blocks (Gravel/Sand) near all players."""
        mw = DEFAULT_CONFIG['game']['map_width']
        mh = DEFAULT_CONFIG['game']['map_height']
        wm = self.server.worlds
        falling_types = {23, 24}  # GRAVEL, SAND
        need_save = False
        
        for username, player in room.players.items():
            check_radius = 15
            start_col = max(0, player.grid_x - check_radius)
            end_col = min(mw - 1, player.grid_x + check_radius)
            start_row = max(0, player.grid_y - check_radius)
            end_row = min(mh - 1, player.grid_y + check_radius)
            
            for y in range(start_row, end_row + 1):
                for x in range(start_col, end_col + 1):
                    tile = wm.get_tile(room.world, x, y)
                    if tile not in falling_types:
                        continue
                    if y >= mh - 1:
                        continue
                    below = wm.get_tile(room.world, x, y + 1)
                    if below == 0:  # EMPTY
                        wm.update_tile(room.room_id, x, y, 0)
                        wm.update_tile(room.room_id, x, y + 1, tile)
                        need_save = True
                        # Broadcast tile updates
                        await self.server.broadcast_to_room(room.room_id, {
                            "type": "tile", "x": x, "y": y, "val": 0
                        })
                        await self.server.broadcast_to_room(room.room_id, {
                            "type": "tile", "x": x, "y": y + 1, "val": tile
                        })
        
        # Save world after falling block changes
        if need_save:
            wm.save_world(room.room_id, room.world)
    
    async def _trigger_random_event(self, room):
        """Trigger a random event near a random player."""
        import random
        if not room.players:
            return
        
        # Pick a random player
        usernames = list(room.players.keys())
        target_name = random.choice(usernames)
        target = room.players[target_name]
        depth = target.grid_y
        
        if depth < 10:
            return
            
        events = [
            ('cave_in', 30, 10),
            ('gas_pocket', 25, 30),
            ('treasure_vault', 15, 50),
            ('fossil_bed', 20, 20),
            ('crystal_geode', 10, 100)
        ]
        
        available = [e for e in events if depth >= e[2]]
        if not available:
            return
            
        total_weight = sum(e[1] for e in available)
        roll = random.random() * total_weight
        selected = available[0]
        for event in available:
            roll -= event[1]
            if roll <= 0:
                selected = event
                break
        
        event_id = selected[0]
        event_x = target.grid_x + random.randint(-10, 10)
        event_y = target.grid_y + random.randint(3, 12)
        
        wm = self.server.worlds
        mw = DEFAULT_CONFIG['game']['map_width']
        mh = DEFAULT_CONFIG['game']['map_height']
        need_save = False
        
        if event_id == 'cave_in':
            radius = 2 + random.randint(0, 1)
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    cx = target.grid_x + dx
                    cy = target.grid_y + dy - radius - 2
                    if 0 <= cx < mw and 5 < cy < mh - 1:
                        if math.sqrt(dx*dx + dy*dy) <= radius:
                            tile = wm.get_tile(room.world, cx, cy)
                            if tile not in (0, 99):
                                wm.update_tile(room.room_id, cx, cy, 0)
                                need_save = True
                                await self.server.broadcast_to_room(room.room_id, {
                                    "type": "tile", "x": cx, "y": cy, "val": 0
                                })
            await self.server.broadcast_to_room(room.room_id, {
                "type": "chat", "id": self.player_id, "name": "System",
                "msg": "⚠️ Cave-in! Debris falling nearby!"
            })
        
        elif event_id == 'treasure_vault':
            vault_ores = [8, 9, 10, 11]  # GOLD, DIAMOND, EMERALD, RUBY
            count = 3 + random.randint(0, 4)
            for _ in range(count):
                vx = event_x + random.randint(-2, 2)
                vy = event_y + random.randint(-2, 2)
                if 0 <= vx < mw and 5 < vy < mh - 1:
                    tile = wm.get_tile(room.world, vx, vy)
                    if tile in (1, 3, 4, 5):  # Stone types
                        ore = random.choice(vault_ores)
                        wm.update_tile(room.room_id, vx, vy, ore)
                        need_save = True
                        await self.server.broadcast_to_room(room.room_id, {
                            "type": "tile", "x": vx, "y": vy, "val": ore
                        })
            await self.server.broadcast_to_room(room.room_id, {
                "type": "chat", "id": self.player_id, "name": "System",
                "msg": "💰 Treasure Vault discovered nearby!"
            })
        
        if need_save:
            wm.save_world(room.room_id, room.world)


# ============================================================================
# SERVER CLASS
# ============================================================================

class MegaMinerServer:
    """Main WebSocket server for Mega Miner NG."""

    def __init__(self, config_path="server_config.json"):
        self.config = load_config(config_path)
        self.accounts = AccountManager(self.config['paths']['accounts_file'], self.config)
        self.worlds = WorldManager(
            self.config['paths']['worlds_directory'],
            self.config['game']['map_width'],
            self.config['game']['map_height']
        )
        self.rooms = {}  # room_id -> Room
        self.player_rooms = {}  # username -> room_id
        self.shutdown_flag = False
        self.dummy_client = DummyClient(self)
        self.world_name = self.config['server'].get('world_name', 'default-world')

    async def start(self):
        """Start the WebSocket server."""
        host = self.config['server']['host']
        port = self.config['server']['port']
        ssl_config = self.config.get('ssl', {})
        ssl_enabled = ssl_config.get('enabled', False)
        protocol = "wss" if ssl_enabled else "ws"
        ssl_context = None

        if ssl_enabled:
            try:
                import ssl as ssl_module
                ssl_context = ssl_module.SSLContext(ssl_module.PROTOCOL_TLS_SERVER)
                ssl_context.load_cert_chain(
                    ssl_config.get('certfile', 'server.crt'),
                    ssl_config.get('keyfile', 'server.key')
                )
                print(f"[SSL] Loaded certificate: {ssl_config['certfile']}")
            except Exception as e:
                print(f"[SSL] Failed to load SSL context: {e}")
                print("[SSL] Falling back to unencrypted WebSocket.")
                ssl_context = None
                protocol = "ws"

        allow_guests = self.config['accounts'].get('allow_guests', True)
        allow_reg = self.config['accounts'].get('allow_registration', True)
        manual_users = list(self.config['accounts'].get('users', {}).keys())

        print(f"""
╔══════════════════════════════════════════════════════╗
║           Mega Miner NG - Dedicated Server           ║
╠══════════════════════════════════════════════════════╣
║  Version: 2.0.0 (Dummy Client)                       ║
║  Port: {port}                                         ║
║  Protocol: {protocol}://{host}:{port}                  ║
║  SSL/TLS: {'Enabled' if ssl_context else 'Disabled'}                   ║
║  World: {self.world_name}                                      ║
║  Max Players: {self.config['server']['max_players']}                          ║
║  Autosave Interval: {self.config['server']['autosave_interval']}s                       ║
║  Allow Registration: {'Yes' if allow_reg else 'No'}                   ║
║  Allow Guests: {'Yes' if allow_guests else 'No'}                        ║
║  Manual Users: {len(manual_users)} ({', '.join(manual_users) if manual_users else 'None'})║
║  Data Directory: {self.config['paths']['data_directory']}/              ║
╚══════════════════════════════════════════════════════╝
        """)

        # Set up signal handlers for graceful shutdown
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                asyncio.get_event_loop().add_signal_handler(
                    sig, lambda: asyncio.create_task(self.shutdown())
                )
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                pass

        # Start autosave loop
        asyncio.create_task(self._autosave_loop())
        
        # Start dummy client update loop
        asyncio.create_task(self._dummy_client_loop())

        # Start the WebSocket server
        async with websockets.serve(
            self.handle_connection,
            host,
            port,
            ssl=ssl_context,
            ping_interval=20,
            ping_timeout=10,
            max_size=10 * 1024 * 1024  # 10MB max message
        ):
            print(f"Server listening on {protocol}://{host}:{port}")
            await asyncio.Future()  # Run forever

    async def shutdown(self):
        """Graceful shutdown."""
        if self.shutdown_flag:
            return
        self.shutdown_flag = True
        print("\nShutting down...")

        # Save all worlds
        print("Saving worlds...")
        self.worlds.save_all()

        # Save sessions
        print("Saving sessions...")
        self.accounts._save_sessions()

        # Notify all players
        for room in self.rooms.values():
            for username, player in list(room.players.items()):
                try:
                    await self.send_to(player.websocket, {
                        "type": "server_shutdown",
                        "message": "Server is shutting down"
                    })
                    await player.websocket.close()
                except Exception:
                    pass

        print("Shutdown complete.")
        sys.exit(0)

    async def _autosave_loop(self):
        """Periodic autosave of worlds."""
        while not self.shutdown_flag:
            await asyncio.sleep(self.config['server']['autosave_interval'])
            self.worlds.save_all()
            saved = len(self.worlds.worlds)
            if saved > 0:
                print(f"[Autosave] Saved {saved} world(s)")

    async def _dummy_client_loop(self):
        """Periodic update for dummy client game logic."""
        while not self.shutdown_flag:
            await asyncio.sleep(0.1)  # 100ms update rate
            for room_id in list(self.rooms.keys()):
                await self.dummy_client.update(room_id)

    async def send_to(self, websocket, data):
        """Send JSON data to a websocket."""
        if getattr(websocket, 'open', getattr(websocket, 'state', None) == websockets.protocol.State.OPEN):
            try:
                await websocket.send(json.dumps(data))
            except Exception:
                pass

    async def broadcast_to_room(self, room_id, data, exclude=None):
        """Send data to all players in a room."""
        room = self.rooms.get(room_id)
        if not room:
            return
        message = json.dumps(data)
        tasks = []
        for username, player in room.players.items():
            if username == exclude:
                continue
            if getattr(player.websocket, 'open', getattr(player.websocket, 'state', None) == websockets.protocol.State.OPEN):
                tasks.append(self.send_to(player.websocket, data))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ========================================================================
    # CONNECTION HANDLER
    # ========================================================================

    async def handle_connection(self, websocket):
        """Handle a new WebSocket connection."""
        remote = websocket.remote_address
        print(f"[Connect] New connection from {remote}")

        # Temporary state until authenticated
        player = None
        room_id = None
        username = None

        try:
            async for raw_message in websocket:
                try:
                    message = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                # Handle different message types
                msg_type = message.get("type")

                if msg_type == "register":
                    response = self.handle_register(message)
                    await self.send_to(websocket, response)

                elif msg_type == "login":
                    response = self.handle_login(message)
                    await self.send_to(websocket, response)
                    if response.get("success"):
                        # Player is now authenticated, wait for join
                        pass

                elif msg_type == "join":
                    # Player joins the server's world
                    result = await self.handle_join(websocket, message, remote)
                    if result:
                        player, room_id, username = result
                    else:
                        # Join failed, send error and close
                        await self.send_to(websocket, {
                            "type": "error",
                            "message": "Failed to join room"
                        })
                        break

                elif msg_type == "ping":
                    await self.send_to(websocket, {"type": "pong"})

                elif player is not None:
                    # Game messages - require being in a room
                    await self.handle_game_message(player, room_id, message)

                else:
                    await self.send_to(websocket, {
                        "type": "error",
                        "message": "Not authenticated. Please login or register first."
                    })

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[Error] Connection error from {remote}: {e}")
        finally:
            # Cleanup on disconnect
            if username and room_id:
                await self.handle_disconnect(username, room_id)

    # ========================================================================
    # ACCOUNT HANDLING
    # ========================================================================

    def handle_register(self, message):
        username = message.get("username", "").strip()
        password = message.get("password", "")

        if not self.config['accounts']['allow_registration']:
            return {"type": "register_result", "success": False, "message": "Registration is disabled"}

        success, msg = self.accounts.register(username, password)
        return {"type": "register_result", "success": success, "message": msg}

    def handle_login(self, message):
        username = message.get("username", "").strip()
        password = message.get("password", "")

        success, msg, token = self.accounts.login(username, password)
        return {
            "type": "login_result",
            "success": success,
            "message": msg,
            "token": token,
            "username": username if success else None
        }

    # ========================================================================
    # ROOM JOINING
    # ========================================================================

    async def handle_join(self, websocket, message, remote):
        """Handle a player joining the server's world."""
        username = message.get("username", "").strip()
        token = message.get("token", "")
        # Ignore client's room request - always use configured world name
        room_id = self.world_name
        color = message.get("color", "#3498db")
        player_data = message.get("playerData", {})

        allow_guests = self.config['accounts'].get('allow_guests', True)
        allow_reg = self.config['accounts'].get('allow_registration', True)

        # Validate session token
        if token:
            validated_user = self.accounts.validate_session(token)
            if validated_user != username:
                await self.send_to(websocket, {
                    "type": "join_result",
                    "success": False,
                    "message": "Invalid session token"
                })
                return None
        else:
            # No token provided - check if guests are allowed
            if not allow_guests:
                await self.send_to(websocket, {
                    "type": "join_result",
                    "success": False,
                    "message": "Guest connections are not allowed. Please login or register."
                })
                return None

            # Guest mode: check if username is available, prepend 'Guest_'
            if not username:
                username = f"Guest_{secrets.token_hex(3)[:6]}"

        # Check for banned accounts
        if self.accounts.is_banned(username):
            await self.send_to(websocket, {
                "type": "join_result",
                "success": False,
                "message": "This account has been banned"
            })
            return None

        # Check if already connected
        if username in self.player_rooms:
            old_room_id = self.player_rooms[username]
            old_room = self.rooms.get(old_room_id)
            if old_room and username in old_room.players:
                # Replace old connection
                old_player = old_room.players[username]
                try:
                    await old_player.websocket.close()
                except Exception:
                    pass
                del old_room.players[username]
                print(f"[Reconnect] {username} reconnecting")

        # Get or create room (always uses world_name)
        if room_id not in self.rooms:
            self.rooms[room_id] = Room(room_id, self.worlds, self.config)
            print(f"[Room] Created room '{room_id}'")

        room = self.rooms[room_id]

        # Check max players
        if len(room.players) >= self.config['server']['max_players']:
            await self.send_to(websocket, {
                "type": "join_result",
                "success": False,
                "message": "Server is full"
            })
            return None

        # Check if username is taken in this room
        if username in room.players and getattr(room.players[username].websocket, 'open', getattr(room.players[username].websocket, 'state', None) == websockets.protocol.State.OPEN):
            await self.send_to(websocket, {
                "type": "join_result",
                "success": False,
                "message": "Username already taken"
            })
            return None

        # Create player state
        player = PlayerState(websocket, username, token)
        player.color = color

        # Restore persistent player data if available
        if username in room.world.get("player_data", {}):
            saved = room.world["player_data"][username]
            player.money = saved.get("money", 0)
            player.drill_tier = saved.get("drillTier", 0)
            player.max_hull = saved.get("maxHull", DEFAULT_CONFIG['game']['max_hull'])
            player.hull = player.max_hull
            player.max_fuel = saved.get("maxFuel", DEFAULT_CONFIG['game']['max_fuel'])
            player.fuel = player.max_fuel
            player.max_cargo = saved.get("maxCargo", DEFAULT_CONFIG['game']['max_cargo'])
            player.heat_resist = saved.get("heatResist", 0)
            player.xray_range = saved.get("xrayRange", 3)
            player.multi_mine = saved.get("multiMine", 0)
            player.color = saved.get("vehColor", color)
            player.teleporters = saved.get("teleporters", [])
            player.blueprints = saved.get("blueprints", [])
            player.achievements = saved.get("achievements", {})
            print(f"[Restore] Restored data for {username}")

        # Persist client player data (inventory, stats, etc)
        if player_data:
            player.inventory = player_data.get("inventory", {})
            player.money = player_data.get("money", player.money)
            player.stats = player_data.get("stats", player.stats)
            player.achievements = player_data.get("achievements", player.achievements)

        # Determine admin (first player to join)
        if room.admin is None:
            room.admin = username
            player.player_id = username  # Admin gets a stable ID

        # Add to room
        room.players[username] = player
        self.player_rooms[username] = room_id
        room.last_activity = time.time()

        print(f"[Join] {username} joined world '{room_id}' (Players: {room.player_count})")

        # Send join result
        world = room.world
        await self.send_to(websocket, {
            "type": "join_result",
            "success": True,
            "message": f"Joined world '{room_id}'",
            "room": room_id,
            "username": username,
            "playerId": player.player_id,
            "isAdmin": username == room.admin,
            "players": [p.to_dict() for p in room.players.values()],
            "bannedIds": world.get("banned_ids", []),
            "proceduralSeed": world.get("procedural_seed", 0)
        })

        # Send map diffs to joining player (client generates base terrain from seed)
        await self.send_map_diffs(websocket, room_id)

        # Notify other players
        await self.broadcast_to_room(room_id, {
            "type": "join",
            "id": player.player_id,
            "username": username,
            "color": player.color,
            "joinedAt": int(player.joined_at * 1000)
        }, exclude=username)

        return player, room_id, username

    async def send_map_diffs(self, websocket, room_id):
        """Send only the diffs (changes from procedural) to a joining client.
        
        The client generates the base terrain from the procedural seed, then
        applies these diffs on top. This is MUCH faster than sending the full map.
        """
        room = self.rooms.get(room_id)
        if not room:
            return
        world = room.world
        diffs = world.get('diffs', [])
        
        # Send diffs in chunks to avoid overwhelming the connection
        chunk_size = 10000
        total_diffs = len(diffs)
        
        if total_diffs == 0:
            # No diffs - just send empty map_data to signal ready
            await self.send_to(websocket, {
                "type": "map_data",
                "diffs": [],
                "more": False,
                "worldTime": int(time.time() * 1000)
            })
            return
        
        for i in range(0, total_diffs, chunk_size):
            chunk = diffs[i:i + chunk_size]
            await self.send_to(websocket, {
                "type": "map_data",
                "diffs": chunk,
                "more": i + chunk_size < total_diffs
            })
            await asyncio.sleep(0.005)  # Small delay to prevent flooding
        
        # Send final chunk with worldTime
        await self.send_to(websocket, {
            "type": "map_data",
            "diffs": [],
            "more": False,
            "worldTime": int(time.time() * 1000)
        })
        
        print(f"[Map] Sent {total_diffs} diffs to joining player")

    # ========================================================================
    # GAME MESSAGE HANDLING
    # ========================================================================

    async def handle_game_message(self, player, room_id, message):
        """Handle game-related messages from an authenticated player."""
        msg_type = message.get("type")

        if msg_type == "move":
            await self.handle_move(player, room_id, message)

        elif msg_type == "heartbeat":
            player.last_heartbeat = time.time()

        elif msg_type == "chat":
            await self.handle_chat(player, room_id, message)

        elif msg_type == "tile_update":
            await self.handle_tile_update(player, room_id, message)

        elif msg_type == "aoe_mine":
            await self.handle_aoe_mine(player, room_id, message)

        elif msg_type == "explode":
            await self.handle_explode(player, room_id, message)

        elif msg_type == "fuel_transfer":
            await self.handle_fuel_transfer(player, room_id, message)

        elif msg_type == "trade":
            await self.handle_trade(player, room_id, message)

        elif msg_type == "death":
            await self.broadcast_to_room(room_id, {
                "type": "death",
                "id": player.player_id,
                "name": player.username
            })

        elif msg_type == "map_query":
            await self.handle_map_query(player, room_id, message)

        elif msg_type == "view_req":
            await self.handle_view_req(player, room_id, message)

        elif msg_type == "admin_action":
            await self.handle_admin_action(player, room_id, message)

        elif msg_type == "save_player_data":
            await self.handle_save_player_data(player, room_id, message)

        elif msg_type == "audio_tag":
            await self.broadcast_to_room(room_id, {
                "type": "soundbite",
                "tag": message.get("tag", ""),
                "id": player.player_id
            }, exclude=player.username)

        elif msg_type == "claim_host":
            # In dummy client mode, admin is always the first player
            # But we allow host transfer between players
            room = self.rooms.get(room_id)
            if room:
                room.admin = player.username
                await self.broadcast_to_room(room_id, {
                    "type": "claim_host",
                    "id": player.username
                })

        elif msg_type == "promote_host":
            await self.handle_promote_host(player, room_id, message)

        elif msg_type == "place_explosive":
            # Player placed TNT or Nuke - register with dummy client
            x = message.get("x")
            y = message.get("y")
            range_val = message.get("range", 3)
            timer = message.get("timer", 2000)
            if x is not None and y is not None:
                self.dummy_client.add_explosive(x, y, range_val, timer)
                # Broadcast the explosion placement to other players
                await self.broadcast_to_room(room_id, {
                    "type": "explode",
                    "id": player.player_id,
                    "x": x,
                    "y": y,
                    "r": range_val,
                    "t": timer
                }, exclude=player.username)

        else:
            # Unknown message types - just log
            pass

    # ========================================================================
    # SPECIFIC MESSAGE HANDLERS
    # ========================================================================

    async def handle_move(self, player, room_id, message):
        """Handle player movement updates."""
        player.last_heartbeat = time.time()
        player.x = message.get("sx", player.x)
        player.y = message.get("sy", player.y)
        player.grid_x = message.get("gx", player.grid_x)
        player.grid_y = message.get("gy", player.grid_y)
        player.rotation = message.get("r", player.rotation)
        player.is_drilling = message.get("drill", player.is_drilling)
        player.color = message.get("col", player.color)

        room = self.rooms.get(room_id)
        is_admin = room and player.username == room.admin

        await self.broadcast_to_room(room_id, {
            "type": "move",
            "id": player.player_id,
            "sx": player.x,
            "sy": player.y,
            "tx": message.get("tx"),
            "ty": message.get("ty"),
            "gx": player.grid_x,
            "gy": player.grid_y,
            "r": player.rotation,
            "col": player.color,
            "drill": player.is_drilling,
            "username": player.username,
            "joinedAt": int(player.joined_at * 1000),
            "isAdmin": is_admin
        }, exclude=player.username)

    async def handle_chat(self, player, room_id, message):
        """Handle chat messages."""
        msg_text = message.get("msg", "")
        await self.broadcast_to_room(room_id, {
            "type": "chat",
            "id": player.player_id,
            "name": player.username,
            "msg": msg_text
        })

    async def handle_tile_update(self, player, room_id, message):
        """Handle single tile update."""
        x = message.get("x")
        y = message.get("y")
        val = message.get("val")
        if x is not None and y is not None and val is not None:
            print(f"[Tile] {player.username} updated tile at ({x},{y}) = {val}")
            self.worlds.update_tile(room_id, x, y, val)
            world = self.rooms.get(room_id).world if self.rooms.get(room_id) else None
            if world:
                diffs_count = len(world.get('diffs', []))
                print(f"[Tile] World now has {diffs_count} diffs")
                # Save world immediately on tile update to prevent data loss
                self.worlds.save_world(room_id, world)
                print(f"[Tile] World saved to disk ({diffs_count} diffs)")
            await self.broadcast_to_room(room_id, {
                "type": "tile",
                "x": x,
                "y": y,
                "val": val
            }, exclude=player.username)

    async def handle_aoe_mine(self, player, room_id, message):
        """Handle AOE mining updates."""
        # AOE mining also changes tiles - save the world
        room = self.rooms.get(room_id)
        await self.broadcast_to_room(room_id, {
            "type": "aoe_mine",
            "id": player.player_id,
            "x": message.get("x"),
            "y": message.get("y"),
            "r": message.get("r", 0),
            "t": message.get("t", 0)
        }, exclude=player.username)

    async def handle_explode(self, player, room_id, message):
        """Handle explosion events - register with dummy client."""
        x = message.get("x")
        y = message.get("y")
        r = message.get("r", 3)
        t = message.get("t", 2000)
        if x is not None and y is not None:
            self.dummy_client.add_explosive(x, y, r, t)
            await self.broadcast_to_room(room_id, {
                "type": "explode",
                "id": player.player_id,
                "x": x,
                "y": y,
                "r": r,
                "t": t
            }, exclude=player.username)

    async def handle_fuel_transfer(self, player, room_id, message):
        """Handle fuel transfers between players."""
        target_username = message.get("to")
        amount = message.get("amt", 0)
        room = self.rooms.get(room_id)
        if room and target_username in room.players:
            target_player = room.players[target_username]
            await self.send_to(target_player.websocket, {
                "type": "fuel",
                "to": target_player.player_id,
                "from": player.username,
                "amt": amount
            })

    async def handle_trade(self, player, room_id, message):
        """Handle resource trading between players."""
        target_username = message.get("to")
        resource = message.get("res", "fuel")
        amount = message.get("amt", 0)
        room = self.rooms.get(room_id)
        if room and target_username in room.players:
            target_player = room.players[target_username]
            await self.send_to(target_player.websocket, {
                "type": "trade",
                "to": target_player.player_id,
                "from": player.username,
                "res": resource,
                "amt": amount
            })

    async def handle_map_query(self, player, room_id, message):
        """Handle map sync requests from clients."""
        room = self.rooms.get(room_id)
        if not room:
            return

        requester_name = message.get("from")
        if requester_name and requester_name in room.players:
            requester = room.players[requester_name]
            # Send all diffs
            diffs = self.worlds.get_all_diffs(room_id)
            chunk_size = 10000
            for i in range(0, len(diffs), chunk_size):
                chunk = diffs[i:i + chunk_size]
                await self.send_to(requester.websocket, {
                    "type": "map_data",
                    "diffs": chunk,
                    "more": i + chunk_size < len(diffs)
                })
                await asyncio.sleep(0.01)

    async def handle_view_req(self, player, room_id, message):
        """Handle viewport sync requests."""
        room = self.rooms.get(room_id)
        if not room:
            return

        requester_name = message.get("id")
        bx = message.get("x", 0)
        by = message.get("y", 0)
        bw = message.get("w", 50)
        bh = message.get("h", 40)

        if requester_name and requester_name in room.players:
            requester = room.players[requester_name]
            diffs = self.worlds.get_area_diff(room_id, bx, by, bw, bh)
            if diffs:
                await self.send_to(requester.websocket, {
                    "type": "map_data",
                    "diffs": diffs,
                    "more": False
                })

    async def handle_admin_action(self, player, room_id, message):
        """Handle admin actions: kick, ban, etc."""
        room = self.rooms.get(room_id)
        if not room or player.username != room.admin:
            return

        action = message.get("action")
        target_username = message.get("target")

        if action == "kick":
            if target_username in room.players:
                target = room.players[target_username]
                await self.send_to(target.websocket, {
                    "type": "kick",
                    "target": target.player_id
                })
                await target.websocket.close()
                del room.players[target_username]
                self.player_rooms.pop(target_username, None)
                await self.broadcast_to_room(room_id, {
                    "type": "system_msg",
                    "message": f"{target_username} was kicked"
                })

        elif action == "ban":
            if target_username in room.players:
                target = room.players[target_username]
                world = room.world
                if target.player_id not in world.get("banned_ids", []):
                    if "banned_ids" not in world:
                        world["banned_ids"] = []
                    world["banned_ids"].append(target.player_id)
                await self.send_to(target.websocket, {
                    "type": "kick",
                    "target": target.player_id
                })
                await target.websocket.close()
                del room.players[target_username]
                self.player_rooms.pop(target_username, None)

        elif action == "transfer_admin":
            if target_username in room.players:
                room.admin = target_username
                await self.broadcast_to_room(room_id, {
                    "type": "promote_host",
                    "target": target_username
                })

    async def handle_save_player_data(self, player, room_id, message):
        """Save player progression data to the world."""
        room = self.rooms.get(room_id)
        if not room:
            return

        data = message.get("data", {})
        if player.username not in room.world.setdefault("player_data", {}):
            room.world["player_data"][player.username] = {}

        room.world["player_data"][player.username].update(data)
        # Also save to disk periodically
        self.worlds.save_world(room_id)

    async def handle_promote_host(self, player, room_id, message):
        """Handle admin promotion requests."""
        room = self.rooms.get(room_id)
        if not room or player.username != room.admin:
            return

        target_username = message.get("target")
        if target_username and target_username in room.players:
            room.admin = target_username
            await self.broadcast_to_room(room_id, {
                "type": "promote_host",
                "target": target_username
            })

    # ========================================================================
    # DISCONNECT HANDLING
    # ========================================================================

    async def handle_disconnect(self, username, room_id):
        """Handle player disconnection."""
        room = self.rooms.get(room_id)
        if not room:
            self.player_rooms.pop(username, None)
            return

        # Save player data before removing
        if username in room.players:
            player = room.players[username]
            # Save persistent player data
            if username not in room.world.setdefault("player_data", {}):
                room.world["player_data"][username] = {}
            room.world["player_data"][username].update({
                "money": player.money,
                "drillTier": player.drill_tier,
                "maxHull": player.max_hull,
                "maxFuel": player.max_fuel,
                "maxCargo": player.max_cargo,
                "heatResist": player.heat_resist,
                "xrayRange": player.xray_range,
                "multiMine": player.multi_mine,
                "vehColor": player.color,
                "teleporters": player.teleporters,
                "blueprints": player.blueprints,
                "achievements": player.achievements
            })
            # Save world to disk - use the room's world object directly
            self.worlds.save_world(room_id, room.world)
            print(f"[Save] Saved progress for {username}")

        # Remove player from room
        if username in room.players:
            del room.players[username]
            self.player_rooms.pop(username, None)
            print(f"[Disconnect] {username} left world '{room_id}' (Players: {room.player_count})")

            # Broadcast leave
            await self.broadcast_to_room(room_id, {
                "type": "leave",
                "id": username,
                "username": username
            })

            # If admin left, assign new admin
            if username == room.admin and room.player_count > 0:
                # Find the next admin by join order
                oldest = None
                for p in room.players.values():
                    if oldest is None or p.joined_at < oldest.joined_at:
                        oldest = p
                if oldest:
                    room.admin = oldest.username
                    await self.broadcast_to_room(room_id, {
                        "type": "claim_host",
                        "id": oldest.username
                    })
                    print(f"[Admin] {oldest.username} is new admin of '{room_id}'")

            # Clean up empty rooms
            if room.player_count == 0:
                print(f"[Room] Room '{room_id}' is now empty, saving...")
                # Save world one more time before cleanup - pass world object directly
                self.worlds.save_world(room_id, room.world)
                # Keep room for a while in case someone rejoins
                asyncio.create_task(self._cleanup_empty_room(room_id))

    async def _cleanup_empty_room(self, room_id):
        """Remove empty rooms after a timeout."""
        await asyncio.sleep(300)  # 5 minutes
        room = self.rooms.get(room_id)
        if room and room.player_count == 0:
            del self.rooms[room_id]
            print(f"[Room] Room '{room_id}' cleaned up")


# ============================================================================
# ENTRY POINT
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Mega Miner NG Dedicated Server")
    parser.add_argument("-c", "--config", default="server_config.json",
                        help="Path to configuration file")
    parser.add_argument("-p", "--port", type=int, default=None,
                        help="Port to listen on (overrides config)")
    parser.add_argument("--host", default=None,
                        help="Host to listen on (overrides config)")
    parser.add_argument("-w", "--world", default=None,
                        help="World name (overrides config)")
    args = parser.parse_args()

    server = MegaMinerServer(args.config)

    # Override from command line
    if args.host:
        server.config['server']['host'] = args.host
    if args.port:
        server.config['server']['port'] = args.port
    if args.world:
        server.config['server']['world_name'] = args.world
        server.world_name = args.world

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        asyncio.run(server.shutdown())


if __name__ == "__main__":
    main()