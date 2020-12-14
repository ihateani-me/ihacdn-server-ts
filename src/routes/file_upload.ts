import express from "express";
import multer from "multer";
import config from "../config.json";
import { generateCustomFilename, getValueFromKey, humanizebytes, is_none, map_bool } from "../utils/swissknife";
import { join, extname, isAbsolute } from "path";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { RedisDB } from "../utils/redisdb";
import { Magic, MAGIC_MIME_TYPE } from "mmmagic";
import moment from "moment-timezone";
import bluebird from "bluebird";
import { PAYLOAD_TOO_LARGE, BLOCKED_EXTENSION } from "../utils/error_message";
import { Notifier } from "../utils/notifier";

// @ts-ignore
const REDIS_INSTANCE = new RedisDB(config.redisdb.host, config.redisdb.port, config.redisdb.password);
const FileNotifier = new Notifier();
bluebird.promisifyAll(Magic.prototype)
const magic = new Magic(MAGIC_MIME_TYPE);

function validateFiletype(extension: string, content_type: string): [boolean, string] {
    if (extension.startsWith(".")) {
        extension = extension.slice(1);
    }
    if (config.blocklist.content_type.includes(content_type)) {
        return [false, content_type];
    }
    if (config.blocklist.extension.includes(extension)) {
        return [false, extension];
    }
    return [true, content_type];
}

class PayloadTooLarge extends Error {
    constructor(public code: number, public filename: string) {
        super();
    }
}

class BlockedMediaTypes extends Error {
    constructor(public code: number, public media_types: string) {
        super();
    }
}


async function generateFilename(): Promise<string> {
    let filename = generateCustomFilename(config.filename_length);
    while (true) {
        if (!["upload", "short", "ping"].includes(filename)) {
            let check_data = await REDIS_INSTANCE.get(`ihacdn${filename}`);
            if (is_none(check_data)) {
                break;
            }
        }
        filename = generateCustomFilename(config.filename_length);
    }
    return filename;
}

async function customFileFilter(req: any, file: Express.Multer.File) {
    let fslimit = config.storage.filesize_limit * 1024;
    let secret = getValueFromKey(req.body, "secret", "");
    let is_admin = false;
    if (typeof secret === "object" && Array.isArray(secret)) {
        secret = secret[0];
    }
    if (secret === config.admin_password) {
        is_admin = true;
    }
    if (is_admin) {
        // @ts-ignore
        fslimit = config.storage.admin_filesize_limit;
        if (!is_none(fslimit)) {
            fslimit = fslimit * 1024;
        }
    }
    if (!is_none(fslimit)) {
        if (file.size > fslimit) {
            throw new PayloadTooLarge(413, file.filename);
        }
    }
    let save_path = join(file.destination, file.filename);
    // @ts-ignore
    let mimetype: string = await magic.detectFileAsync(save_path);
    let extension = extname(file.originalname);
    let [valid_type, invalid_type] = validateFiletype(extension, mimetype);
    if (!valid_type && !is_admin) {
        throw new BlockedMediaTypes(415, invalid_type);
    }
    let filename = file.filename.replace(extension, "");
    if (extension.startsWith(".")) {
        extension = extension.slice(1);
    }
    let is_code = mimetype.startsWith("text");
    let added_time = moment.tz("UTC").unix() * 1000;
    await REDIS_INSTANCE.set(filename, {
        "type": is_code ? "code" : "file",
        "is_admin": is_admin,
        "path": file.path,
        "mimetype": is_code ? extension : mimetype,
        "time_added": added_time
    });
    let ipaddr = req.headers["x-forwarded-for"] || req.connection.remoteAddress || req.ip;
    if (Array.isArray(ipaddr)) {
        ipaddr = ipaddr[0];
    }
    await FileNotifier.notifyAll({
        filename: file.filename,
        type: is_code ? "code" : "file",
        is_admin: is_admin,
        uploader_ip: ipaddr
    })
    return true;
}

const Storage = multer.diskStorage({
    destination: function(req, _f, cb) {
        let secret = getValueFromKey(req.body, "secret", "");
        let is_admin = false;
        if (typeof secret === "object" && Array.isArray(secret)) {
            secret = secret[0];
        }
        if (secret === config.admin_password) {
            is_admin = true;
        }
        let save_path = config.upload_path;
        if (is_admin) {
            save_path = join(save_path, "uploads_admin");
        } else {
            save_path = join(save_path, "uploads");
        }
        if (!isAbsolute(save_path)) {
            save_path = join(process.cwd(), save_path);
        }
        if (!existsSync(save_path)) {
            mkdirSync(save_path);
        }
        cb(null, save_path);
    },
    filename: async function (req, file, cb) {
        let force_original = map_bool(getValueFromKey(req.body, "forceoriginal", "0"));
        if (force_original) {
            cb(null, file.originalname);
        } else {
            let generated_fn = await generateFilename();
            cb(null, generated_fn + extname(file.originalname));
        }
    },
})
const Uploader = multer({
    storage: Storage,
    // fileFilter: 
})
const UploadAPI = express.Router();
const fileupload = Uploader.single("file");

UploadAPI.post("/", (req, res) => {
    let ipaddr = req.headers["x-forwarded-for"] || req.connection.remoteAddress || req.ip;
    console.log(`[UploadAPI] Upload request received from ${ipaddr}`);
    fileupload(req, res, (err: any) => {
        console.log(`[UploadAPI] Sending response to ${ipaddr}...`);
        if (err instanceof multer.MulterError) {
            console.log(`[UploadAPI:MulterError] ${err.toString()}`);
            res.status(500).end("Server failed to process uploaded file.");
        } else if (err instanceof PayloadTooLarge) {
            console.log(`[UploadAPI:PayloadTooLarge] File exceeded maximum filesize.`);
            let payload_err = PAYLOAD_TOO_LARGE;
            payload_err = payload_err.replace(/\{\{ FN \}\}/g, err.filename);
            payload_err = payload_err.replace(/\{\{ FS \}\}/g, humanizebytes(config.storage.filesize_limit * 1024));
            res.status(413).end(payload_err);
        } else if (err instanceof BlockedMediaTypes) {
            console.log(`[UploadAPI:BlockedMediaType] User tried to upload ${err.media_types} to server.`);
            let blocked_err = BLOCKED_EXTENSION;
            blocked_err = blocked_err.replace("{{ FILE_TYPE }}", err.media_types);
            res.status(415).end(blocked_err);
        } else if (err instanceof Error) {
            console.log(`[UploadAPI:Error] ${err.toString()}`);
            res.status(500).end("Server failed to process uploaded file.");
        } else {
            let req_file = req.file;
            console.log(`[UploadAPI:Validation] Validating file from ${ipaddr}`);
            customFileFilter(req, req_file).then(() => {
                let final_url = "http://";
                if (config.https_mode) {
                    final_url = "https://";
                }
                console.log(`[UploadAPI:Validation] File from ${ipaddr} validated!`);
                final_url += `${config.hostname}/${req_file.filename}`;
                res.status(200).end(final_url);
            }).catch((err) => {
                try {
                    unlinkSync(req_file.path)
                } catch (e) {};
                if (err instanceof PayloadTooLarge) {
                    console.log(`[UploadAPI:PayloadTooLarge] User ${ipaddr} file exceeded maximum filesize.`);
                    let payload_err = PAYLOAD_TOO_LARGE;
                    payload_err = payload_err.replace(/\{\{ FN \}\}/g, err.filename);
                    payload_err = payload_err.replace(/\{\{ FS \}\}/g, humanizebytes(config.storage.filesize_limit * 1024));
                    res.status(413).end(payload_err);
                } else if (err instanceof BlockedMediaTypes) {
                    console.log(`[UploadAPI:BlockedMediaType] User IP ${ipaddr} tried to upload ${err.media_types} to server.`);
                    let blocked_err = BLOCKED_EXTENSION;
                    blocked_err = blocked_err.replace("{{ FILE_TYPE }}", err.media_types);
                    res.status(415).end(blocked_err);
                } else {
                    console.log(`[UploadAPI:Error] ${err.toString()}`);
                    res.status(500).end("Server failed to process uploaded file.");
                }
            })
        }
    })
})

export { UploadAPI };