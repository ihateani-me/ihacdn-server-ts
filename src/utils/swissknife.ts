/**
 * Check if the variable is a null type or not.
 * @param { any } key - things that want to be checked.
 * @returns { boolean } `true` or `false`
 */
export function is_none(key: any): boolean {
    if (typeof key == "undefined") {
        return true;
    } else if (key == null) {
        return true;
    }
    return false;
}

/**
 * Convert a string/number to a number using fallback if it's NaN (Not a number).
 * If fallback is not specified, it will return to_convert.
 * @param cb parseFloat or parseInt function that will be run
 * @param to_convert number or string to convert
 * @param fallback fallback number
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function fallbackNaN(cb: Function, to_convert: unknown, fallback?: unknown): unknown {
    if (isNaN(cb(to_convert))) {
        return is_none(fallback) ? to_convert : fallback;
    } else {
        return cb(to_convert);
    }
}

/**
 * Check if an Object have a key.
 * @param { Object } object_data - an Object that need checking.
 * @param { string } key_name - key that will be checked.
 * @returns { boolean } `true` or `false`
 */
export function hasKey(object_data: any, key_name: string): boolean {
    if (is_none(object_data)) {
        return false;
    }
    if (Object.keys(object_data).includes(key_name)) {
        return true;
    }
    return false;
}

/**
 * Get a key of an Object.
 * @param { Object } object_data - an Object that need checking.
 * @param { string } key_name - key that will be checked.
 * @param { string } defaults - fallback
 * @returns { string } value of the inputted key.
 */
export function getValueFromKey(object_data: any, key_name: string, defaults: any = null): any {
    if (is_none(object_data)) {
        return defaults;
    }
    if (!hasKey(object_data, key_name)) {
        return defaults;
    }
    let all_keys = Object.keys(object_data);
    let index = all_keys.findIndex(key => key === key_name);
    return object_data[all_keys[index]];
}

/**
 * Map a string to a boolean, used for Express query.
 * @param { any } input_data - data to map
 * @returns { boolean } mapped boolean
 */
export function map_bool(input_data: any): boolean {
    if (is_none(input_data)) {
        return false;
    }
    let fstat = false;
    try {
        input_data = input_data.toLowerCase();
    } catch (error) { input_data = input_data.toString().toLowerCase(); };
    switch (input_data) {
        case "y":
            fstat = true;
            break;
        case "enable":
            fstat = true;
            break;
        case "true":
            fstat = true;
            break;
        case "1":
            fstat = true;
            break;
        case "yes":
            fstat = true;
            break;
        default:
            break;
    }
    return fstat;
}

export function humanizebytes(bytes: number): string {
    if (is_none(bytes)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return bytes;
    }
    const kbytes = 1024.0;
    const mbytes = 1024.0 ** 2;
    const gbytes = 1024.0 ** 3;
    const tbytes = 1024.0 ** 4;
    const pbytes = 1024.0 ** 5;

    if (bytes < kbytes) {
        if (bytes > 2) {
            return `${bytes.toString()} Bytes`
        }
        return `${bytes.toString()} Byte`
    } else if (kbytes <= bytes && bytes < mbytes) {
        return `${(bytes / kbytes).toFixed(2)} KiB`;
    } else if (mbytes <= bytes && bytes < gbytes) {
        return `${(bytes / mbytes).toFixed(2)} MiB`;
    } else if (gbytes <= bytes && bytes < tbytes) {
        return `${(bytes / gbytes).toFixed(2)} GiB`;
    } else if (tbytes <= bytes && bytes < pbytes) {
        return `${(bytes / tbytes).toFixed(2)} TiB`;
    }
    return `${(bytes / pbytes).toFixed(2)} PiB`;
}

function rng(max: number): number {
    return Math.floor(Math.random() * max);
}

const ASCII_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const ASCII_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";
export function generateCustomFilename(length = 8, includeNumbers = false, includeUppercase = false): string {
    let letters_used = ASCII_LOWERCASE;
    if (includeNumbers) {
        letters_used += NUMBERS;
    }
    if (includeUppercase) {
        letters_used += ASCII_UPPERCASE;
    }
    const charlengths = letters_used.length;
    let generated = "";
    for (let i = 0; i < length; i++) {
        generated += letters_used.charAt(rng(charlengths));
    }
    return generated;
}