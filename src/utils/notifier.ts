import axios from "axios";
import main_config from "../config";
import { is_none } from "./swissknife";

export interface NotifierConfig {
    enable: boolean
    discord_webhook?: string | null
}

export interface NotifierRequest {
    filename: string
    type: string
    is_admin: boolean
    uploader_ip: string
}

export class Notifier {
    public config: NotifierConfig
    private hoststring: string

    constructor() {
        this.config = main_config.notifier;
        let hoststring = "http://"
        if (main_config.https_mode) {
            hoststring = "https://"
        }
        hoststring += main_config.hostname;
        this.hoststring = hoststring;
    }

    async notifyDiscord(config: NotifierRequest): Promise<void> {
        if (is_none(this.config.discord_webhook) || !this.config.discord_webhook) {
            return;
        }
        let full_url = `${this.hoststring}/${config.filename}`;
        let is_admin = config.is_admin ? "Yes" : "No";
        let msg_content = [
            `Uploader IP: **${config.uploader_ip}**`
        ]
        if (config.type === "short") {
            msg_content.push(`Short Link: <${full_url}>`);
        } else {
            msg_content.push(`File: <${full_url}>`);
        }
        msg_content.push(`Is Admin? **${is_admin}**`);
        let request_payload = {
            "content": msg_content.join("\n"),
            "avatar_url": "https://p.ihateani.me/static/img/favicon.png",
            "username": "ihaCDN Notificator",
            "tts": false,
        }
        await axios.post(this.config.discord_webhook, request_payload, {
            headers: {
                "Content-Type": "application/json"
            }
        });
    }

    async notifyAll(config: NotifierRequest) {
        if (!this.config.enable) {
            return;
        }
        await Promise.all([this.notifyDiscord(config)]);
    }
}