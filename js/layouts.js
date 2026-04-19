// Port of ris58h.exkeymo.web.Layouts (Layouts.java).
// Given a base layout .kcm string (or the default) and user-supplied code->keyCode mappings,
// produce a final .kcm text: if a mapping targets a code already present in the base layout,
// the original line is commented out (matching the server's behaviour). Any remaining
// unmatched user mappings are appended under a "Modifications" section at the end.

const DEFAULT_LAYOUT = 'type OVERLAY\n';
const MODIFICATIONS_TRAILING_COMMENT = '# Modifications made by ExKeyMo project:\n';

/**
 * @param {string|null} baseLayoutText Contents of the base layout file, or null to use the default.
 * @param {Map<string,string>|Object<string,string>} mappings scan code -> android key
 * @returns {string} final .kcm content
 */
export function fromLayout(baseLayoutText, mappings) {
    const layout = baseLayoutText ?? DEFAULT_LAYOUT;
    const map = mappingsToMap(mappings);

    if (map.size === 0) {
        return layout;
    }

    let sb = '';
    const remaining = writeBaseLayout(layout, map, (chunk) => { sb += chunk; });

    if (remaining.size > 0) {
        sb += '\n' + MODIFICATIONS_TRAILING_COMMENT;
        for (const [code, keyCode] of remaining) {
            sb += `map key ${code} ${keyCode}\n`;
        }
    }

    return sb;
}

function mappingsToMap(mappings) {
    if (mappings instanceof Map) return new Map(mappings);
    const m = new Map();
    for (const k of Object.keys(mappings)) m.set(k, mappings[k]);
    return m;
}

/**
 * Writes the base layout to the emitter, commenting out any lines that
 * conflict with user mappings. Returns the user mappings that weren't
 * already present in the base layout with an identical value.
 */
function writeBaseLayout(layout, mappings, emit) {
    if (!layout.includes('map ')) {
        emit(layout);
        return mappings;
    }
    const remaining = new Map(mappings);
    for (const line of splitLinesKeepEmpty(layout)) {
        const mapKey = parseMapKey(line);
        if (mapKey !== null) {
            const code = (mapKey.usage ? 'usage ' : '') + mapKey.code;
            const userKeyCode = remaining.get(code);
            if (userKeyCode !== undefined) {
                if (userKeyCode === mapKey.keyCode) {
                    remaining.delete(code);
                } else {
                    emit(MODIFICATIONS_TRAILING_COMMENT);
                    emit('# ');
                }
            }
        }
        emit(line);
        emit('\n');
    }
    return remaining;
}

/**
 * Replicates Java's Scanner.nextLine() over the input: returns lines without
 * their terminator. Trailing empty lines created by a final '\n' are dropped,
 * matching java.util.Scanner behaviour.
 */
function splitLinesKeepEmpty(s) {
    const parts = s.split(/\r\n|\r|\n/);
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    return parts;
}

function parseMapKey(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('map ')) return null;
    // NB: splits on the unmodified line, like Java's line.split(" ")
    const split = line.split(' ');
    if (split.length < 4) return null;
    if (split[1] !== 'key') return null;
    if (split[2] === 'usage') {
        if (split.length !== 5) return null;
        return { usage: true, code: split[3], keyCode: split[4] };
    } else {
        if (split.length !== 4) return null;
        return { usage: false, code: split[2], keyCode: split[3] };
    }
}
