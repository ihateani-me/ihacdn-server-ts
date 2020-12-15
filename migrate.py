import json
import os
import pathlib
import sys
from datetime import datetime

import diskcache
import redis

settings = {
    "redis": {
        "host": "127.0.0.1",
        "port": 6379,
        "password": None
    },
    "diskcache_path": "/var/www/ihacdn/diskcache",
    "new_uploads_path": "/var/www/ihacdn-ts/"  # Don't put the `uploads` or `uploads_admin`
}


def ping_diskcache(cachedb):
    ping = cachedb.get("ping")
    if not ping:
        res = cachedb.set("ping", "pong")
        if not res:
            return False
        ping = cachedb.get("ping")
    if ping != "pong":
        return False
    return True


print("[Migrate] Initializing connection...")
cachedb = diskcache.Cache(settings["diskcache_path"])
redisdb = redis.Redis(**settings["redis"])

print("[Migrate] Checking connection to both database...")
if not ping_diskcache(cachedb):
    print("[Migrate:diskcache] Failed to ping diskcache server, exiting...")
    sys.exit(1)
try:
    test = redisdb.get("ping")
except Exception:
    print("[Migrate:redis] Failed to ping redis server, exiting...")
    sys.exit(1)

print("[Migrate:diskcache] Fetching all keys and old data...")
all_old_keys = list(cachedb.iterkeys())
print(all_old_keys)
all_old_keys = [key for key in all_old_keys if key and not isinstance(key, list)]
all_old_data = [cachedb.get(k) for k in all_old_keys]

print(f"[Migrate] Processing: {len(all_old_keys)} keys")
for n, old_data in enumerate(all_old_data):
    try:
        old_data = json.loads(old_data)
    except Exception:
        print(f"[Migrate] Failed to parse key: {all_old_keys[n]} |", old_data)
        continue
    if old_data["type"] == "short":
        print(f"\t[Migrate:short] Migrating {all_old_keys[n]}")
        redisdb.set(f"ihacdn{all_old_keys[n]}", json.dumps({
            "type": old_data["type"],
            "target": old_data["target"]
        }, ensure_ascii=False))
    else:
        print(f"\t[Migrate:file] Migrating {all_old_keys[n]}")
        is_admin = False
        if "uploads_admin" in old_data["path"]:
            is_admin = True
        try:
            fname = pathlib.Path(old_data["path"])
            ctime = datetime.fromtimestamp(fname.stat().st_ctime).timestamp() * 1000
        except Exception:
            print("\t\t[Migration:Error] Missing file on path, ignoring and continuing...")
            continue
        filename = os.path.basename(old_data["path"])
        new_path = os.path.join(
            settings["new_uploads_path"],
            "uploads" if not is_admin else "uploads_admin"
        )
        if not os.path.isdir(new_path):
            os.makedirs(new_path)
        new_path = os.path.join(new_path, filename)
        try:
            os.rename(old_data["path"], new_path)
        except Exception:
            print("\t\t[Migration:warning] Failed to move file, ignoring...")
        redisdb.set(f"ihacdn{all_old_keys[n]}", json.dumps({
            "type": old_data["type"],
            "is_admin": is_admin,
            "path": new_path,
            "mimetype": old_data["mimetype"],
            "time_added": ctime
        }, ensure_ascii=False))
