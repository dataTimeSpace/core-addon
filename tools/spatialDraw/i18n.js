/*
 * Translations for this tool frame: the same small helper in every tool that shows text.
 *
 *   const i18n = createToolI18n(spatialInterface, 'myTool'); // ns = the tool's folder name
 *   i18n.onChange(() => {
 *       someElement.textContent = i18n.t('panel.label', 'English default');
 *   });
 *
 * - Catalogs: locales/<locale>/<ns>.json next to index.html, loaded by spatialInterface.loadTranslations
 *   (edge-server objectDefaultFiles/object.js). locales/en is generated from the t() calls in the tool's own files
 *   by `npm run i18n:extract-tools`; the English defaults in the code are the source.
 * - t(key, defaultValue, options) has i18next semantics: whole sentences with {{placeholders}} filled from options
 *   (HTML-escaped unless options.interpolation.escapeValue is false), plurals with options.count and
 *   defaultValue_one / defaultValue_other.
 * - onChange(render) calls render now and again whenever the language or its catalogs change, so whatever render
 *   sets (DOM text, canvas text, labels in the 3D scene) follows the language; it returns a function that stops
 *   the calls. Numbers shown to people go through Intl with i18n.getLanguage(); unit symbols stay as they are.
 * - English is the code's own defaults, so nothing is fetched while the language is English.
 * - An older edge server (no loadTranslations) shows the English defaults and formats for the browser language.
 */
(function() {
    const HTML_ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '/': '&#x2F;'};

    /**
     * The English default with its {{placeholders}} filled in, as i18next shows it without a catalog.
     * @param {string} key
     * @param {string|Object} [defaultValue] - the English text, or the options (with options.defaultValue)
     * @param {Object} [options] - placeholder values, count, defaultValue_one / defaultValue_other
     * @return {string}
     */
    function translateDefault(key, defaultValue, options) {
        if (defaultValue !== null && typeof defaultValue === 'object') {
            options = defaultValue;
            defaultValue = options.defaultValue;
        }
        options = options || {};
        let text = defaultValue;
        if (typeof options.count === 'number') {
            const pluralDefault = options[options.count === 1 ? 'defaultValue_one' : 'defaultValue_other'];
            if (typeof pluralDefault === 'string') {
                text = pluralDefault;
            }
        }
        if (typeof text !== 'string') {
            return String(key);
        }
        const escape = !(options.interpolation && options.interpolation.escapeValue === false);
        return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(options, name)) {
                return match;
            }
            const value = String(options[name]);
            return escape ? value.replace(/[&<>"'/]/g, (c) => HTML_ESCAPES[c]) : value;
        });
    }

    /**
     * Sets up the translations of one tool frame.
     * @param {SpatialInterface} spatialInterface
     * @param {string} ns - the tool's namespace, its folder name
     * @return {{t: function(string, (string|Object)=, Object=): string, getLanguage: function(): string,
     *     onChange: function(function()): function()}}
     */
    function createToolI18n(spatialInterface, ns) {
        let translate = translateDefault;
        let requestedLanguage = null;
        let latestRequest = 0;
        const renderers = [];

        function getLanguage() {
            if (typeof spatialInterface.getLanguage === 'function') {
                return spatialInterface.getLanguage();
            }
            return navigator.language || 'en';
        }

        function runRenderer(renderer) {
            try {
                renderer();
            } catch (e) {
                console.warn(ns + ': could not show the text in ' + getLanguage(), e);
            }
        }

        function render() {
            document.documentElement.lang = getLanguage();
            renderers.slice().forEach(runRenderer);
        }

        // The t from loadTranslations switches only once the new catalogs have arrived, after onLanguageChanged
        // has fired. Asking again resolves at that moment (with the same t: one i18next instance per tool).
        function useLanguage(language) {
            if (language === requestedLanguage) {
                return;
            }
            requestedLanguage = language;
            const requestId = ++latestRequest;
            if (language === 'en') {
                translate = translateDefault;
                render();
                return;
            }
            spatialInterface.loadTranslations({ns: ns, path: 'locales'}).then((t) => {
                if (requestId === latestRequest) {
                    translate = t;
                    render();
                }
            }).catch((e) => {
                console.warn(ns + ': translations are not available, showing English', e);
            });
        }

        if (typeof spatialInterface.loadTranslations === 'function') {
            if (typeof spatialInterface.onLanguageChanged === 'function') {
                spatialInterface.onLanguageChanged(useLanguage);
            }
            useLanguage(getLanguage());
        }

        return {
            t: (key, defaultValue, options) => translate(key, defaultValue, options),
            getLanguage: getLanguage,
            onChange: (renderer) => {
                renderers.push(renderer);
                document.documentElement.lang = getLanguage();
                runRenderer(renderer);
                return () => {
                    const index = renderers.indexOf(renderer);
                    if (index !== -1) {
                        renderers.splice(index, 1);
                    }
                };
            }
        };
    }

    window.createToolI18n = createToolI18n;
})();
