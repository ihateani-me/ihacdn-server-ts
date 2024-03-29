import _ from "lodash";

import express from "express";
import multer from "multer";
import config from "../config";
import { generateCustomFilename, getValueFromKey, humanizebytes, is_none, map_bool } from "../utils/swissknife";
import { join, extname, isAbsolute } from "path";
import { existsSync, mkdirSync, unlinkSync, rename as fsrename, mkdir as fsmkdir } from "fs";
import { promisify } from "util";
import { RedisDB } from "../utils/redisdb";
import { Magic, MAGIC_MIME_TYPE } from "mmmagic";
import moment from "moment-timezone";
import bluebird from "bluebird";
import { PAYLOAD_TOO_LARGE, BLOCKED_EXTENSION } from "../utils/error_message";
import { Notifier } from "../utils/notifier";
import { logger as MainLogger } from "../utils/logger";

const rename = promisify(fsrename);
const mkdir = promisify(fsmkdir);
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

function selectFirst(st: string[] | string | undefined): string | undefined {
    if (is_none(st)) {
        return undefined;
    }
    if (Array.isArray(st)) {
        return st[0];
    }
    return st;
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
    let force_original = map_bool(getValueFromKey(req.body, "forceoriginal", "0"));
    let secret = getValueFromKey(req.body, "secret", "");
    const { retention } = req.query;
    // @ts-ignore
    const firstRetention = selectFirst(retention);
    let is_admin = false;
    if (typeof secret === "object" && Array.isArray(secret)) {
        secret = secret[0];
    }
    if (secret === config.admin_password) {
        is_admin = true;
    }
    let upload_path = config.upload_path;
    if (is_admin) {
        upload_path = join(upload_path, "uploads_admin");
    } else {
        upload_path = join(upload_path, "uploads");
    }
    if (!isAbsolute(upload_path)) {
        upload_path = join(process.cwd(), upload_path);
    }
    if (!existsSync(upload_path)) {
        await mkdir(upload_path);
    }
    let save_path = join(upload_path);
    let original_name = file.originalname.split(".");
    let extension = extname(file.originalname);
    let temp_name = join(file.destination, file.filename);
    let save_key = file.originalname.replace(extname(file.originalname), "");
    let original_save_name = _.nth(original_name, 0);
    if (original_name.length > 1) {
        extension = "." + _.nth(original_name, -1);
        original_save_name = _.join(_.initial(original_name), ".");
    } else {
        extension = "";
    }
    if (force_original) {
        // @ts-ignore
        save_key = original_save_name;
        save_path = join(upload_path, original_save_name + extension);
    } else {
        let gen_name = await generateFilename();
        save_key = gen_name;
        save_path = join(upload_path, gen_name + extname(file.originalname));
    }
    await rename(temp_name, save_path);
    let fslimit = null;
    if (!is_none(config.storage.filesize_limit)) {
        fslimit = config.storage.filesize_limit * 1024;
    };
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
    // @ts-ignore
    let mimetype: string = await magic.detectFileAsync(save_path);
    let [valid_type, invalid_type] = validateFiletype(extension, mimetype);
    if (!valid_type && !is_admin) {
        throw new BlockedMediaTypes(415, invalid_type);
    }
    if (extension.startsWith(".")) {
        extension = extension.slice(1);
    }
    let is_code = mimetype.startsWith("text");
    let added_time = moment.tz("UTC").unix() * 1000;
    let delete_time = null;
    if (!is_none(firstRetention)) {
        const asNumberRet = parseInt(firstRetention);
        if (!isNaN(asNumberRet)) {
            // convert day to second
            const asNumberRetActual = asNumberRet * 24 * 60 * 60;
            delete_time = added_time + asNumberRetActual
        }
    }
    await REDIS_INSTANCE.set(`ihacdn${save_key}`, {
        "type": is_code ? "code" : "file",
        "is_admin": is_admin,
        "path": save_path,
        "mimetype": is_code ? extension : mimetype,
        "time_added": added_time,
        "delete_at": delete_time,
    });
    let ipaddr = req.headers["x-forwarded-for"] || req.connection.remoteAddress || req.ip;
    if (Array.isArray(ipaddr)) {
        ipaddr = ipaddr[0];
    }
    await FileNotifier.notifyAll({
        filename: `${save_key}.${extension}`,
        type: is_code ? "code" : "file",
        is_admin: is_admin,
        uploader_ip: ipaddr
    })
    return `${save_key}.${extension}`;
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
        let temp = generateCustomFilename(4, false, true);
        cb(null, `ihatemp${temp}_` + file.originalname);
    },
})
const Uploader = multer({
    storage: Storage,
    // fileFilter: 
})
const UploadAPI = express.Router();
const fileupload = Uploader.single("file");

UploadAPI.post("/", (req, res) => {
    let ipArrays = req.ips;
    const logger = MainLogger.child({cls: "CDM", fn: "UploadAPI"});
    logger.info(`Upload request received from ${ipArrays.join(", ")}`);
    fileupload(req, res, (err: any) => {
        logger.info(`Sending response back to ${ipArrays.join(", ")}`);
        if (err instanceof multer.MulterError) {
            logger.error(`MulterError: ${err.toString()}`);
            res.status(500).end("Server failed to process uploaded file.");
        } else if (err instanceof PayloadTooLarge) {
            logger.error(`MulterError::PayloadTooLarge: File exceeded maximum filesize.`);
            let payload_err = PAYLOAD_TOO_LARGE;
            payload_err = payload_err.replace(/\{\{ FN \}\}/g, err.filename);
            let fslimit = "No limit";
            if (!is_none(config.storage.filesize_limit)) {
                fslimit = humanizebytes(config.storage.filesize_limit * 1024);
            };
            payload_err = payload_err.replace(/\{\{ FS \}\}/g, fslimit);
            res.status(413).end(payload_err);
        } else if (err instanceof BlockedMediaTypes) {
            logger.error(`MulterError::BlockedMediaType: User tried to upload ${err.media_types} to server.`);
            let blocked_err = BLOCKED_EXTENSION;
            blocked_err = blocked_err.replace("{{ FILE_TYPE }}", err.media_types);
            res.status(415).end(blocked_err);
        } else if (err instanceof Error) {
            logger.error(`MulterError::Error: ${err.toString()}`);
            res.status(500).end("Server failed to process uploaded file.");
        } else {
            let req_file = req.file;
            logger.info(`Validating file from ${ipArrays.join(", ")}`);
            customFileFilter(req, req_file).then((filename) => {
                let final_url = "http://";
                if (config.https_mode) {
                    final_url = "https://";
                }
                logger.info(`File from ${ipArrays.join(", ")} validated, returning!`);
                final_url += `${config.hostname}/${filename}`;
                res.status(200).end(final_url);
            }).catch((err) => {
                try {
                    unlinkSync(req_file.path)
                } catch (e) {};
                if (err instanceof PayloadTooLarge) {
                    logger.error(`PayloadTooLarge: User ${ipArrays.join(", ")} file exceeded maximum filesize.`);
                    let payload_err = PAYLOAD_TOO_LARGE;
                    payload_err = payload_err.replace(/\{\{ FN \}\}/g, err.filename);
                    let fslimit = "No limit";
                    if (!is_none(config.storage.filesize_limit)) {
                        fslimit = humanizebytes(config.storage.filesize_limit * 1024);
                    };
                    payload_err = payload_err.replace(/\{\{ FS \}\}/g, fslimit);
                    res.status(413).end(payload_err);
                } else if (err instanceof BlockedMediaTypes) {
                    logger.error(`BlockedMediaTypes: User ${ipArrays.join(", ")} tried to upload ${err.media_types} to server.`);
                    let blocked_err = BLOCKED_EXTENSION;
                    blocked_err = blocked_err.replace("{{ FILE_TYPE }}", err.media_types);
                    res.status(415).end(blocked_err);
                } else {
                    logger.error(`Error: User ${ipArrays.join(", ")} upload got a generic Error: ${err.toString()}`);
                    res.status(500).end("Server failed to process uploaded file.");
                }
            })
        }
    })
})

export { UploadAPI };