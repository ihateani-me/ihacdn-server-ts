import Redis from "ioredis";
import { fallbackNaN, is_none } from "../utils/swissknife";

export class RedisDB {
    client: Redis.Redis;
    usable: boolean;
    host: string;
    port: number;

    constructor(host: string, port: number, password?: string | null) {
        this.host = host;
        this.port = port;
        let redisDB;
        if (!is_none(password)) {
            redisDB = new Redis(port, host, {
                password: password,
            });
        } else {
            redisDB = new Redis(port, host);
        }
        this.client = redisDB;
        this.usable = true;
    }

    close(): void {
        this.client.disconnect();
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private async safe_call(callback: Function): Promise<any> {
        try {
            const res = await callback();
            return res;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    private stringify(value: any): string {
        if (Array.isArray(value)) {
            value = JSON.stringify(value);
        } else if (typeof value === "object" && Object.keys(value).length > 0) {
            value = JSON.stringify(value);
        } else if (typeof value === "number") {
            value = value.toString();
        }
        return value;
    }

    private toOriginal(value: any): any {
        if (is_none(value)) {
            return null;
        }
        if (Buffer.isBuffer(value)) {
            return value;
        }
        try {
            value = JSON.parse(value);
        } catch (e) {}
        if (typeof value === "string") {
            value = fallbackNaN(parseFloat, value);
        }
        return value;
    }

    async get(key: string, return_ttl: boolean = false): Promise<any> {
        let res = await this.client.get(key);
        res = this.toOriginal(res);
        if (return_ttl && !is_none(res)) {
            const ttl_left = await this.client.ttl(key);
            return [res, ttl_left];
        } else if (return_ttl && is_none(res)) {
            return [res, 0];
        }
        return res;
    }

    async set(key: string, value: any): Promise<boolean> {
        const res = await this.client.set(key, this.stringify(value));
        if (res == "OK") {
            return true;
        }
        return false;
    }

    async setex(key: string, expired: number, value: any): Promise<any> {
        if (Number.isInteger(expired)) {
            expired = Math.ceil(expired);
        }
        const res = await this.client.setex(key, expired, this.stringify(value));
        if (res == "OK") {
            return true;
        }
        return false;
    }

    async delete(key: string): Promise<void> {
        await this.client.del(key);
    }

    async ping(): Promise<void> {
        console.log(`[RedisClient:${this.host}] Pinging server...`);
        let res = await this.safe_call(this.get.bind(this, "ping"));
        if (is_none(res)) {
            const res_set = await this.safe_call(this.set.bind(this, "ping", "pong"));
            if (!res_set) {
                console.error(`[RedisClient:${this.host}] Ping failed, not usable!`);
                this.usable = false;
                return;
            }
            res = await this.safe_call(this.get.bind(this, "ping"));
        }
        if (res !== "pong") {
            console.error(`[RedisClient:${this.host}] Ping failed, not usable!`);
            this.usable = false;
        } else {
            console.log(`[RedisClient:${this.host}] Pong!`);
            this.usable = true;
        }
    }
}
