import moment from "moment-timezone";
import { unlink as fsunlink, stat as fsstat } from "fs";
import { promisify } from "util"

import config from "../config.json";
import { RedisDB } from "./redisdb";
import { is_none } from "./swissknife";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);
const stat = promisify(fsstat);
const unlink = promisify(fsunlink);

interface ihaCDNObject {
    type: "short" | "code" | "file"
    is_admin?: boolean
    path?: string
    target?: string
    mimetype?: string
    time_added?: number
}

function retentionMax(fsize: number, is_admin: boolean): number {
    let ret = config.file_retention;
    let limit = is_admin ? config.storage.admin_filesize_limit : config.storage.filesize_limit
    if (is_none(limit)) {
        return -1;
    }
    // @ts-ignore
    return ret.min_age + (-ret.max_age + ret.min_age) * (fsize / (limit * 1024)) ** 5;
}

export async function clearExpiredFile(): Promise<void> {
    if (!config.file_retention.enable) {
        return;
    }
    let ihacdn_keys = await REDIS_INSTANCE.client.keys("ihacdn*");
    if (ihacdn_keys.length < 1) {
        return;
    }
    let ihacdn_items = await REDIS_INSTANCE.client.mget(ihacdn_keys);
    if (ihacdn_items.length < 1) {
        return;
    }
    console.log(`[Retention] Checking ${ihacdn_keys.length} keys`)
    let current_time = moment.tz("UTC").unix() * 1000;
    for (let idx = 0; idx < ihacdn_items.length; idx++) {
        // @ts-ignore
        let item: ihaCDNObject = JSON.parse(ihacdn_items[idx]);
        if (item["type"] !== "short") {
            // @ts-ignore
            let fsize = await stat(item["path"]);
            // @ts-ignore
            let file_age = moment.duration(current_time - item["time_added"]).asDays();
            // @ts-ignore
            let max_age = retentionMax(fsize, item["is_admin"]);
            if (file_age > max_age) {
                console.log(`[Retention] Deleting: ${ihacdn_keys[idx].slice(6)}`);
                await REDIS_INSTANCE.delete(ihacdn_keys[idx]);
                // @ts-ignore
                await unlink(item["path"]);
            }
        }
    }
}
