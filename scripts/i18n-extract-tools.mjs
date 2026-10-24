#!/usr/bin/env node
// i18n-extract-tools.mjs (npm run i18n:extract-tools; add `-- --check` to compare without writing)
//
// Writes the English catalog tools/<tool>/locales/en/<tool>.json of every tool whose index.html loads the
// translation helper (objectDefaultFiles/i18n.js, served by the edge server), from the t('key', 'English default')
// calls in the tool's own .js, .mjs and .html files (inline scripts only). Vendored folders (resources,
// thirdPartyCode, node_modules) and *.min.js are skipped. The English catalogs are generated, never edited by hand: keys sorted and nested at the dots
// (i18next's key separator), 2-space JSON with a trailing newline, like the interface catalogs. A call whose options
// carry `count` gives <key>_one and <key>_other (i18next JSON v4), from defaultValue_one / defaultValue_other when
// given, else from the default.
//
// Exits with 1 when a call has no literal key or no literal English default, a key has two different defaults, two
// keys collide, or (with --check) a catalog is not up to date.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
const HELPER_SCRIPT = /<script[^>]+src=["']objectDefaultFiles\/i18n\.js["']/;
const SOURCE_LOCALE = 'en';
const SKIPPED_DIRECTORIES = ['locales', 'node_modules', 'resources', 'thirdPartyCode'];
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.html'];
const KEYWORDS_BEFORE_REGEX = ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
    'case', 'do', 'else', 'yield', 'await'];
const ESCAPES = {n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0'};

/**
 * @param {string} tool - folder name
 * @return {boolean} whether the tool's index.html loads objectDefaultFiles/i18n.js
 */
function loadsHelper(tool) {
    const indexHtml = path.join(TOOLS_DIR, tool, 'index.html');
    return fs.existsSync(indexHtml) && HELPER_SCRIPT.test(fs.readFileSync(indexHtml, 'utf8'));
}

/**
 * @return {Array<string>} the folder names of the tools that use the translation helper
 */
function listTools() {
    return fs.readdirSync(TOOLS_DIR, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && loadsHelper(entry.name))
        .map((entry) => entry.name)
        .sort();
}

/**
 * @param {string} toolDir - absolute path of the tool folder
 * @return {Array<string>} the tool's own source files, absolute
 */
function listSourceFiles(toolDir) {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
                    walk(full);
                }
            } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith('.min.js')) {
                files.push(full);
            }
        }
    };
    walk(toolDir);
    return files.sort();
}

/**
 * Reads the string literal starting at source[start]: '...', "..." or a template literal without ${}.
 * @param {string} source
 * @param {number} start
 * @return {{value: string, end: number}|null} end = the index after the closing quote; null if there is none
 */
function readStringLiteral(source, start) {
    const quote = source[start];
    if (quote !== '\'' && quote !== '"' && quote !== '`') {
        return null;
    }
    let value = '';
    for (let i = start + 1; i < source.length; i++) {
        const c = source[i];
        if (c === quote) {
            return {value, end: i + 1};
        }
        if (c === '\\') {
            const next = source[i + 1];
            const hex = next === 'u' ? /^u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(source.slice(i + 1, i + 12))
                : next === 'x' ? /^x([0-9a-fA-F]{2})/.exec(source.slice(i + 1, i + 4)) : null;
            if (hex) {
                value += String.fromCodePoint(parseInt(hex[1] || hex[2], 16));
                i += hex[0].length;
            } else if (next === '\n') {
                i += 1; // a line continuation adds nothing
            } else {
                value += Object.prototype.hasOwnProperty.call(ESCAPES, next) ? ESCAPES[next] : next;
                i += 1;
            }
            continue;
        }
        if ((quote === '`' && c === '$' && source[i + 1] === '{') || (quote !== '`' && c === '\n')) {
            return null;
        }
        value += c;
    }
    return null;
}

/**
 * @param {string} source
 * @param {number} index
 * @return {number} the index of the next character that is not whitespace
 */
function skipSpace(source, index) {
    while (index < source.length && /\s/.test(source[index])) {
        index++;
    }
    return index;
}

/**
 * Finds every t( call in JavaScript code, skipping comments, strings and regular expressions and looking into
 * template literal expressions.
 * @param {string} source
 * @return {Array<number>} the index of each call's opening parenthesis
 */
function findCalls(source) {
    const calls = [];
    const templateDepths = []; // the brace depth at which each open ${ expression ends
    let braceDepth = 0;
    let previous = ''; // the last token: a punctuator character or a word ('' at the start)
    let i = 0;

    const scanTemplate = (from) => { // from: just inside the template; returns where code continues
        for (let j = from; j < source.length; j++) {
            if (source[j] === '\\') {
                j++;
            } else if (source[j] === '`') {
                return j + 1;
            } else if (source[j] === '$' && source[j + 1] === '{') {
                templateDepths.push(braceDepth);
                braceDepth++;
                return j + 2;
            }
        }
        return source.length;
    };

    while (i < source.length) {
        const c = source[i];
        if (/\s/.test(c)) {
            i++;
        } else if (c === '/' && source[i + 1] === '/') {
            const end = source.indexOf('\n', i);
            i = end === -1 ? source.length : end;
        } else if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            i = end === -1 ? source.length : end + 2;
        } else if (c === '\'' || c === '"') {
            let j = i + 1;
            while (j < source.length && source[j] !== c && source[j] !== '\n') {
                j += source[j] === '\\' ? 2 : 1;
            }
            i = j + 1;
            previous = c;
        } else if (c === '`') {
            i = scanTemplate(i + 1);
            previous = '`';
        } else if (c === '/' && (previous === '' || /^[(,=:[!&|?{};+*%<>~^-]$/.test(previous) ||
            KEYWORDS_BEFORE_REGEX.includes(previous))) {
            let j = i + 1;
            let inClass = false;
            while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
                if (source[j] === '\\') {
                    j++;
                } else if (source[j] === '[') {
                    inClass = true;
                } else if (source[j] === ']') {
                    inClass = false;
                }
                j++;
            }
            i = j + 1;
            while (i < source.length && /[a-z]/.test(source[i])) {
                i++; // flags
            }
            previous = 'regex';
        } else if (c === '}' && templateDepths.length && templateDepths[templateDepths.length - 1] === braceDepth - 1) {
            templateDepths.pop();
            braceDepth--;
            i = scanTemplate(i + 1);
            previous = '`';
        } else if (/[A-Za-z_$]/.test(c)) {
            let j = i;
            while (j < source.length && /[\w$]/.test(source[j])) {
                j++;
            }
            const word = source.slice(i, j);
            const after = skipSpace(source, j);
            if (word === 't' && source[after] === '(') {
                calls.push(after);
            }
            previous = word;
            i = j;
        } else {
            if (c === '{') {
                braceDepth++;
            } else if (c === '}') {
                braceDepth--;
            }
            previous = /[0-9]/.test(c) ? 'number' : c;
            i++;
        }
    }
    return calls;
}

/**
 * @param {string} source
 * @param {number} start - the index of an opening brace
 * @return {string|null} the object literal's text including its braces, null if it is not closed
 */
function readObjectText(source, start) {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (c === '\'' || c === '"' || c === '`') {
            const literal = readStringLiteral(source, i);
            if (!literal) {
                return null;
            }
            i = literal.end - 1;
        } else if (c === '{') {
            depth++;
        } else if (c === '}' && --depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * Reads the key and English defaults of one t( call.
 * @param {string} source
 * @param {number} open - the index of the call's opening parenthesis
 * @return {{entries: Array<[string, string]>, error: (string|undefined)}} [key, English text] pairs
 */
function parseCall(source, open) {
    const key = readStringLiteral(source, skipSpace(source, open + 1));
    if (!key) {
        return {entries: [], error: 'the key is not a string literal'};
    }
    let defaultValue;
    let optionsText = '';
    let j = skipSpace(source, key.end);
    if (source[j] === ',') {
        j = skipSpace(source, j + 1);
        const literal = readStringLiteral(source, j);
        if (literal) {
            defaultValue = literal.value;
            j = skipSpace(source, literal.end);
            if (source[j] === ',') {
                j = skipSpace(source, j + 1);
                optionsText = source[j] === '{' ? readObjectText(source, j) : '';
            } else if (source[j] !== ')') {
                return {entries: [], error: `the English default of "${key.value}" is not one string literal`};
            }
        } else if (source[j] === '{') {
            optionsText = readObjectText(source, j);
        } else {
            return {entries: [], error: `the English default of "${key.value}" is not a string literal`};
        }
    }
    if (optionsText === null) {
        return {entries: [], error: `the options of "${key.value}" are not a closed object literal`};
    }

    const defaults = {};
    const optionPattern = /(?:^|[{,])\s*(defaultValue(?:_one|_other)?)\s*:\s*/g;
    let match;
    while ((match = optionPattern.exec(optionsText))) {
        const literal = readStringLiteral(optionsText, match.index + match[0].length);
        if (!literal) {
            return {entries: [], error: `${match[1]} of "${key.value}" is not a string literal`};
        }
        defaults[match[1]] = literal.value;
    }
    if (typeof defaultValue !== 'string') {
        defaultValue = defaults.defaultValue;
    }

    const isPlural = /(?:^|[{,])\s*count\s*(?:[:,}])/.test(optionsText);
    const entries = isPlural ? [
        [key.value + '_one', defaults.defaultValue_one || defaultValue],
        [key.value + '_other', defaults.defaultValue_other || defaultValue],
    ] : [[key.value, defaultValue]];
    const missing = entries.find(([, value]) => typeof value !== 'string' || value === '');
    if (missing) {
        return {entries: [], error: `"${missing[0]}" has no English default`};
    }
    return {entries};
}

/**
 * @param {string} file - absolute path
 * @return {Array<{code: string, offset: number}>} the JavaScript in the file (an HTML file's inline scripts)
 */
function readCode(file) {
    const text = fs.readFileSync(file, 'utf8');
    if (path.extname(file) !== '.html') {
        return [{code: text, offset: 0}];
    }
    const scripts = [];
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptPattern.exec(text))) {
        if (!/\bsrc\s*=/.test(match[1])) {
            scripts.push({code: match[2], offset: match.index + match[0].indexOf('>') + 1});
        }
    }
    return scripts;
}

/**
 * Collects the keys of one tool.
 * @param {string} tool - the tool's folder name
 * @return {{entries: Map<string, {value: string, location: string}>, errors: Array<string>}}
 */
function collectKeys(tool) {
    const toolDir = path.join(TOOLS_DIR, tool);
    const entries = new Map();
    const errors = [];
    for (const file of listSourceFiles(toolDir)) {
        const fullText = fs.readFileSync(file, 'utf8');
        for (const {code, offset} of readCode(file)) {
            for (const open of findCalls(code)) {
                const line = fullText.slice(0, offset + open).split('\n').length;
                const location = `${path.relative(REPO_ROOT, file)}:${line}`;
                const result = parseCall(code, open);
                if (result.error) {
                    errors.push(`${location}: ${result.error}`);
                }
                for (const [key, value] of result.entries) {
                    const existing = entries.get(key);
                    if (!existing) {
                        entries.set(key, {value, location});
                    } else if (existing.value !== value) {
                        errors.push(`${location}: "${key}" has two English defaults, ${JSON.stringify(existing.value)} ` +
                            `(${existing.location}) and ${JSON.stringify(value)}`);
                    }
                }
            }
        }
    }
    return {entries, errors};
}

/**
 * @param {object} value
 * @return {object} a copy with the keys sorted at every level
 */
function sortDeep(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = sortDeep(value[key]);
    }
    return sorted;
}

/**
 * Builds the nested catalog from dotted keys.
 * @param {Map<string, {value: string}>} entries
 * @return {{catalog: object, errors: Array<string>}}
 */
function buildCatalog(entries) {
    const catalog = {};
    const errors = [];
    for (const dottedKey of [...entries.keys()].sort()) {
        const parts = dottedKey.split('.');
        let node = catalog;
        let collision = null;
        for (let i = 0; i < parts.length - 1 && !collision; i++) {
            if (typeof node[parts[i]] === 'string') {
                collision = `"${dottedKey}" collides with the key "${parts.slice(0, i + 1).join('.')}"`;
            } else {
                node = node[parts[i]] = node[parts[i]] || {};
            }
        }
        const leaf = parts[parts.length - 1];
        if (!collision && node[leaf] && typeof node[leaf] === 'object') {
            collision = `"${dottedKey}" collides with the keys below it`;
        }
        if (collision) {
            errors.push(collision);
        } else {
            node[leaf] = entries.get(dottedKey).value;
        }
    }
    return {catalog: sortDeep(catalog), errors};
}

function main() {
    const check = process.argv.includes('--check');
    const problems = [];
    for (const tool of listTools()) {
        const {entries, errors} = collectKeys(tool);
        const {catalog, errors: catalogErrors} = buildCatalog(entries);
        problems.push(...errors.map((error) => `${tool}: ${error}`), ...catalogErrors.map((error) => `${tool}: ${error}`));
        const file = path.join(TOOLS_DIR, tool, 'locales', SOURCE_LOCALE, `${tool}.json`);
        const content = JSON.stringify(catalog, null, 2) + '\n';
        const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        const relative = path.relative(REPO_ROOT, file);
        if (previous === content) {
            process.stdout.write(`${relative}: ${entries.size} keys, up to date\n`);
        } else if (check) {
            problems.push(`${relative} is not up to date; run npm run i18n:extract-tools`);
        } else {
            fs.mkdirSync(path.dirname(file), {recursive: true});
            fs.writeFileSync(file, content);
            process.stdout.write(`${relative}: ${entries.size} keys, written\n`);
        }
    }
    if (problems.length) {
        problems.forEach((problem) => process.stderr.write(`error: ${problem}\n`));
        process.exitCode = 1;
    }
}

main();
