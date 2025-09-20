// ==UserScript==
// @name         F-List Live Profile Preview
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  Adds a live side-panel preview for the character editor that fully inherits the site's theme and component styles.
// @author       Gemini
// @match        *://*.f-list.net/character_edit.php*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Hide elements immediately to prevent FOUC (Flash of Unstyled Content)
    GM_addStyle('#Sidebar, #Content { visibility: hidden; }');

    /* global $, unsafeWindow, GM_addStyle */

    // -------------------------------------------------
    // START: BBCode Parser (No changes in this section)
    // -------------------------------------------------
    const appendTextWithLineBreaks = (parent, text) => {
        if (!parent || typeof text !== 'string') return;
        
        // Preserve all whitespace including multiple spaces, but allow wrapping
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            if (line.length > 0) {
                // Create a span with white-space: pre-wrap to preserve spaces but allow wrapping
                const span = document.createElement('span');
                span.style.whiteSpace = 'pre-wrap';
                span.textContent = line;
                parent.appendChild(span);
            }
            if (index < lines.length - 1) {
                parent.appendChild(document.createElement('br'));
            }
        });
    };
    class BBCodeTag {
        noClosingTag = false;
        allowedTags = undefined;
        constructor(tag, tagList) { this.tag = tag; if (tagList !== undefined) this.setAllowedTags(tagList); }
        isAllowed(tag) { return this.allowedTags === undefined || this.allowedTags[tag] !== undefined; }
        setAllowedTags(allowed) { this.allowedTags = {}; for (const tag of allowed) this.allowedTags[tag] = true; }
    }
    class BBCodeSimpleTag extends BBCodeTag {
        constructor(tag, elementName, classes, tagList) { super(tag, tagList); this.elementName = elementName; this.classes = classes; }
        createElement(parser, parent, param) {
            const el = parser.createElement(this.elementName);
            if (this.classes !== undefined && this.classes.length > 0) { el.className = this.classes.join(' '); }
            parent.appendChild(el); return el;
        }
    }
    class BBCodeCustomTag extends BBCodeTag {
        constructor(tag, customCreator, tagList) { super(tag, tagList); this.customCreator = customCreator; }
        createElement(parser, parent, param) { return this.customCreator(parser, parent, param); }
    }
    class BBCodeTextTag extends BBCodeTag {
        constructor(tag, customCreator) { super(tag, []); this.customCreator = customCreator; }
        createElement(parser, parent, param, content) { return this.customCreator(parser, parent, param, content); }
    }
    class BBCodeParser {
        _tags = {}; _line = 1; _column = 1; _currentTag = { tag: '<root>', line: 1, column: 1 };
        addTag(impl) { this._tags[impl.tag] = impl; }
        createElement(tag) { return document.createElement(tag); }
        parseEverything(input) {
            const parent = this.createElement('span'); parent.className = 'bbcode';
            this.parse(input, 0, undefined, parent, () => true, 0); return parent;
        }
        parse(input, start, self, parent, isAllowed, depth) {
            let currentTag = this._currentTag;
            if (self !== undefined) {
                const parentAllowed = isAllowed; isAllowed = name => self.isAllowed(name) && parentAllowed(name);
                currentTag = this._currentTag = { tag: self.tag, line: this._line, column: this._column };
            }
            let tagStart = -1, paramStart = -1, mark = start;
            for (let i = start; i < input.length; ++i) {
                const c = input[i];
                if (c === '\n') { this._line++; this._column = 1; } else { this._column++; }
                if (c === '[') { tagStart = i; paramStart = -1;
                } else if (c === '=' && tagStart !== -1 && paramStart === -1) { paramStart = i;
                } else if (c === ']' && tagStart !== -1) {
                    const paramIndex = paramStart === -1 ? i : paramStart;
                    let tagKey = input.substring(tagStart + 1, paramIndex).trim().toLowerCase();
                    if (tagKey.length === 0) { tagStart = -1; continue; }
                    const param = paramStart > tagStart ? input.substring(paramStart + 1, i) : '';
                    const close = tagKey[0] === '/';
                    if (close) tagKey = tagKey.substr(1).trim();
                    if (this._tags[tagKey] === undefined) { tagStart = -1; continue; }
                    const tag = this._tags[tagKey];
                    if (!close) {
                        if (parent !== undefined) { appendTextWithLineBreaks(parent, input.substring(mark, tagStart)); }
                        mark = i + 1;
                        if (!isAllowed(tagKey) || parent === undefined || depth > 100) {
                            i = this.parse(input, i + 1, tag, undefined, isAllowed, depth + 1); mark = i + 1; continue;
                        }
                        if (tag instanceof BBCodeTextTag) {
                            const endPos = this.parse(input, i + 1, tag, undefined, isAllowed, depth + 1);
                            const contentEnd = input.lastIndexOf('[', endPos);
                            const content = input.substring(mark, contentEnd > mark ? contentEnd : mark);
                            tag.createElement(this, parent, param.trim(), content); i = endPos;
                        } else {
                            const element = tag.createElement(this, parent, param.trim());
                            if (element !== undefined && !tag.noClosingTag) { i = this.parse(input, i + 1, tag, element, isAllowed, depth + 1); }
                        }
                        mark = i + 1; this._currentTag = currentTag;
                    } else if (self !== undefined && self.tag === tagKey) {
                        if (parent !== undefined) { appendTextWithLineBreaks(parent, input.substring(mark, tagStart)); }
                        return i;
                    }
                    tagStart = -1;
                }
            }
            if (mark < input.length && parent !== undefined) { appendTextWithLineBreaks(parent, input.substring(mark)); }
            return input.length;
        }
    }
    // -------------------------------------------------
    // END: BBCode Parser
    // -------------------------------------------------


    // -------------------------------------------------
    // START: F-List Parser Configuration (No changes here)
    // -------------------------------------------------
    function createFListParser() {
        const parser = new BBCodeParser();
        parser.addTag(new BBCodeSimpleTag('b', 'b'));
        parser.addTag(new BBCodeSimpleTag('i', 'i'));
        parser.addTag(new BBCodeSimpleTag('u', 'u'));
        parser.addTag(new BBCodeSimpleTag('s', 's'));
        parser.addTag(new BBCodeSimpleTag('sup', 'sup'));
        parser.addTag(new BBCodeSimpleTag('sub', 'sub'));
        parser.addTag(new BBCodeSimpleTag('quote', 'blockquote'));
        const hrTag = new BBCodeSimpleTag('hr', 'hr');
        hrTag.noClosingTag = true;
        parser.addTag(hrTag);
        parser.addTag(new BBCodeCustomTag('center', (p, parent) => {
            const el = p.createElement('div'); el.style.textAlign = 'center'; parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeCustomTag('right', (p, parent) => {
            const el = p.createElement('div'); el.style.textAlign = 'right'; parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeCustomTag('justify', (p, parent) => {
            const el = p.createElement('div'); el.style.textAlign = 'justify'; parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeCustomTag('left', (p, parent) => {
            const el = p.createElement('div'); el.style.textAlign = 'left'; parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeCustomTag('indent', (p, parent) => {
            const el = p.createElement('div'); el.style.paddingLeft = '3em'; parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeSimpleTag('big', 'span', ['bigtext']));
        parser.addTag(new BBCodeSimpleTag('small', 'span', ['smalltext']));
        parser.addTag(new BBCodeSimpleTag('heading', 'h2'));
        parser.addTag(new BBCodeCustomTag('color', (p, parent, param) => {
            const el = p.createElement('span');
            if (/^(#([0-9a-f]{3}){1,2}|[a-z]+)$/i.test(param)) {
                el.style.color = param;
                // Store the color value as a data attribute for potential nested handling
                el.setAttribute('data-color', param);
            }
            parent.appendChild(el); return el;
        }));
        parser.addTag(new BBCodeTextTag('url', (p, parent, param, content) => {
            let url = param.trim();
            let text = content.trim();

            if (!url) {
                url = text;
            }
            
            if (text === '') {
                text = url;
            }

            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                const a = p.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer nofollow';
                a.style.color = 'inherit';

                const contentParser = createFListParser();
                delete contentParser._tags['url'];
                
                const parsedContent = contentParser.parseEverything(text);
                a.innerHTML = parsedContent.innerHTML;

                parent.appendChild(a);

                const domainSpan = p.createElement('span');
                const domainMatch = url.match(/:\/\/(?:www\.)?([^\/]+)/);
                if (domainMatch) {
                    domainSpan.textContent = ` [${domainMatch[1]}]`;
                    domainSpan.style.fontSize = '0.8em';
                    parent.appendChild(domainSpan);
                }
            } else {
                appendTextWithLineBreaks(parent, `[url${param ? '=' + param : ''}]${content}[/url]`);
            }
        }));
        parser.addTag(new BBCodeTextTag('img', (p, parent, param, content) => {
            const img = p.createElement('img'); img.style.maxWidth = '100%';
            if (param) {
                const inlines = unsafeWindow.FList.Inlines.inlines;
                const inlineData = inlines ? inlines[param] : null;
                if (inlineData) {
                    const { hash, extension } = inlineData;
                    img.src = `https://static.f-list.net/images/charinline/${hash.substring(0, 2)}/${hash.substring(2, 4)}/${hash}.${extension}`;
                    img.alt = content.trim();
                    parent.appendChild(img);
                } else {
                    // Inline image not found or doesn't belong to account - display raw BBCode
                    appendTextWithLineBreaks(parent, `[img=${param}]${content}[/img]`);
                    return;
                }
            } else {
                const url = content.trim();
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    img.src = url;
                    parent.appendChild(img);
                }
                else {
                    appendTextWithLineBreaks(parent, `[img]${content}[/img]`);
                    return;
                }
            }
        }));
        const createUserTag = (p, parent, param, content) => {
            const name = content.trim(); if (!name) return;
            const a = p.createElement('a');
            a.href = `https://www.f-list.net/c/${encodeURIComponent(name)}`; a.target = '_blank'; a.className = 'character-icon';
            const img = p.createElement('img');
            img.src = `https://static.f-list.net/images/avatar/${name.toLowerCase().replace(/ /g, '%20')}.png`;
            img.style.cssText = 'width:50px; height:50px; vertical-align:middle; margin-right:5px; border: 0;';
            a.appendChild(img); parent.appendChild(a);
        };
        parser.addTag(new BBCodeTextTag('icon', createUserTag));
        parser.addTag(new BBCodeTextTag('user', (p, parent, param, content) => {
            const name = content.trim(); if (!name) return;
            const a = p.createElement('a');
            a.href = `https://www.f-list.net/c/${encodeURIComponent(name)}`;
            a.target = '_blank';
            a.className = 'AvatarLink';
            appendTextWithLineBreaks(a, name);
            parent.appendChild(a);
        }));
        parser.addTag(new BBCodeCustomTag('collapse', (p, parent, param) => {
            const header = p.createElement('div'); header.className = 'CollapseHeader';
            const headerText = p.createElement('div'); headerText.className = 'CollapseHeaderText';
            const headerSpan = p.createElement('span');
            appendTextWithLineBreaks(headerSpan, param || '\u00A0');
            headerText.appendChild(headerSpan); header.appendChild(headerText);
            const block = p.createElement('div'); block.className = 'CollapseBlock';
            block.style.display = 'none';
            parent.appendChild(header);
            parent.appendChild(block);
            $(header).on('click', function() {
                $(this).toggleClass('ExpandedHeader');
                $(block).slideToggle(200);
            });
            return block;
        }));
        parser.addTag(new BBCodeTextTag('noparse', (p, parent, param, content) => {
            appendTextWithLineBreaks(parent, content);
        }));
        parser.addTag(new BBCodeTextTag('session', (p, parent, param, content) => {
            const a = p.createElement('a');
            a.href = '#';
            a.onclick = () => false;
            a.className = 'SessionLink';
            a.textContent = content.trim();
            parent.appendChild(a);
        }));
        parser.addTag(new BBCodeTextTag('eicon', (p, parent, param, content) => {
            const img = p.createElement('img');
            img.src = `https://static.f-list.net/images/eicon/${content.trim().toLowerCase()}.gif`;
            img.className = 'eicon';
            img.style.width = '50px';
            img.style.height = '50px';
            parent.appendChild(img);
        }));
        return parser;
    }
    // -------------------------------------------------
    // END: F-List Parser Configuration
    // -------------------------------------------------

    function waitForElementAndRun() {
        const interval = setInterval(function() {
            if (document.getElementById('Content') && typeof unsafeWindow.FList !== 'undefined' && typeof unsafeWindow.FList.Inlines !== 'undefined') {
                clearInterval(interval);
                main();
            }
        }, 100);
    }

    function main() {
        // --- KEY CHANGE: Updated CSS ---
        GM_addStyle(`
            #Sidebar {
                width: 40px !important;
                min-width: 40px !important;
                padding: 0 !important;
            }
            #Content {
                display: flex;
                gap: 10px;
            }
            #editor-wrapper {
                flex: 1;
                min-width: 300px;
                height: 85vh;
                overflow-y: auto;
                overflow-x: hidden; /* Prevent horizontal scrollbar */
                padding: 5px;
                box-sizing: border-box;
            }
            #editor-wrapper > form > table, #tabs {
                width: 100% !important;
                box-sizing: border-box;
            }
            #editor-wrapper .panel {
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            #live-preview-sidebar {
                flex: 0 0 auto; /* Don't grow or shrink, use explicit width */
                min-width: 300px;
                box-sizing: border-box;
                height: 85vh; /* Set a fixed height to prevent overlap */
                display: flex;
                flex-direction: column;
            }
            #live-preview-wrapper {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0; /* Prevents flexbox overflow issues */
            }
            #preview-header {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 0 10px 10px 10px;
                color: #ccc;
            }
            .width-control {
                display: flex;
                align-items: center;
            }
            .width-control input[type=range] {
                flex: 1;
                margin: 0 10px;
            }
            .width-control .width-label {
                min-width: 45px;
                text-align: right;
            }
            #live-preview-content.panel {
                flex: 1;
                overflow: auto;
                overflow-x: auto; /* Move horizontal scroll to panel level */
                background-image: none !important;
                /* background-color is now set by JS for theme consistency */
                padding: 5px;
                box-sizing: border-box;
                min-width: 0; /* Allow the panel to shrink below content size */
            }
            #live-preview-content .character-description {
                transform-origin: top left;
                /* Scaling will be applied by JS */
                max-width: 100%;
                min-width: 300px;
                width: fit-content; /* Ensure content fits within constraints */
                /* overflow-x: auto; REMOVED - scrollbar moved to panel level */
                line-height: 1.4;
                word-wrap: break-word;
            }
            #live-preview-content .CollapseBlock {
                background-color: #4C4646;
                padding: 10px;
                margin: 0;
            }
            #CharacterEditDescription {
                resize: vertical !important;
            }
            #live-preview-content h2 {
                color: #78c624 !important;
            }
        `);

        const contentCell = document.getElementById('Content');
        const originalSidebar = document.getElementById('Sidebar');
        if (!contentCell || !originalSidebar) return;

        // Remove the content from the original sidebar, keeping it as a decorative element
        originalSidebar.innerHTML = '';

        // Create a new subheader for width controls below the navigation bar
        const widthControlsHeader = document.createElement('div');
        widthControlsHeader.id = 'width-controls-header';
        widthControlsHeader.style.padding = '10px';
        widthControlsHeader.style.backgroundColor = '#2A2525'; // Default F-List header color
        widthControlsHeader.style.borderBottom = '1px solid #444';
        widthControlsHeader.innerHTML = `
            <div class="width-control">
                <span>Content Width:</span>
                <input type="range" id="content-width-slider" min="300" max="1200" value="659">
                <span class="width-label" id="content-width-label">659px</span>
            </div>
            <div class="width-control">
                <span>Panel Width:</span>
                <input type="range" id="panel-width-slider" min="300" max="1200" value="659">
                <span class="width-label" id="panel-width-label">659px</span>
            </div>`;

        // Insert the width controls header before the content cell
        contentCell.parentNode.insertBefore(widthControlsHeader, contentCell);

        // Create a wrapper for the existing editor content
        const editorWrapper = document.createElement('div');
        editorWrapper.id = 'editor-wrapper';

        // --- KEY CHANGE: Create a new sidebar that wraps the preview ---
        const previewSidebarWrapper = document.createElement('div');
        previewSidebarWrapper.id = 'live-preview-sidebar';

        // Get theme colors
        const sidebarStyle = window.getComputedStyle(originalSidebar);
        const contentStyle = window.getComputedStyle(contentCell);
        const originalSidebarColor = sidebarStyle.backgroundColor;
        const contentBackgroundColor = contentStyle.backgroundColor;

        // Apply themed colors to the new sidebar
        previewSidebarWrapper.style.backgroundColor = contentBackgroundColor;
        previewSidebarWrapper.style.padding = '10px';
        previewSidebarWrapper.style.borderLeft = sidebarStyle.borderLeft;

        // This inner wrapper holds the preview content itself
        const previewWrapper = document.createElement('div');
        previewWrapper.id = 'live-preview-wrapper';
        previewWrapper.innerHTML = `
            <div id="live-preview-content" class="panel"><div class="character-description" style="max-width: 659px;"></div></div>`;

        // Apply themed color to the inner panel
        const previewContentPanel = previewWrapper.querySelector('#live-preview-content');
        if (previewContentPanel) {
            previewContentPanel.style.backgroundColor = originalSidebarColor;
        }

        // Place the preview content inside the new styled sidebar
        previewSidebarWrapper.appendChild(previewWrapper);

        // Move all of the original editor content into its own wrapper
        while (contentCell.firstChild) {
            editorWrapper.appendChild(contentCell.firstChild);
        }

        // Add the editor and the new preview sidebar back to the main content area
        contentCell.appendChild(editorWrapper);
        contentCell.appendChild(previewSidebarWrapper);

        // --- KEY CHANGE: Make elements visible now that the layout is ready ---
        GM_addStyle('#Sidebar, #Content { visibility: visible; }');

        // Get references to the textarea and the preview display area
        const descriptionTextarea = document.getElementById('CharacterEditDescription');
        const previewContentDiv = document.querySelector('#live-preview-content .character-description');
        const parser = createFListParser();

        let previewTimeout;
        const updatePreview = () => {
            const bbcode = descriptionTextarea.value;
            if (!bbcode.trim()) {
                previewContentDiv.innerHTML = '<em>Start typing to see a preview...</em>';
                return;
            }
            try {
                const parsedElement = parser.parseEverything(bbcode);
                previewContentDiv.innerHTML = '';
                previewContentDiv.appendChild(parsedElement);
            } catch (e) {
                console.error("F-List Live Preview: Error during parsing.", e);
                previewContentDiv.innerHTML = `<em style="color: red;">Error parsing BBCode. See console for details.</em>`;
            }
        };

        const debouncedUpdatePreview = () => {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(updatePreview, 300);
        };

        descriptionTextarea.addEventListener('input', debouncedUpdatePreview);
        updatePreview();

        const contentWidthSlider = document.getElementById('content-width-slider');
        const contentWidthLabel = document.getElementById('content-width-label');
        const panelWidthSlider = document.getElementById('panel-width-slider');
        const panelWidthLabel = document.getElementById('panel-width-label');
        const previewContent = document.querySelector('#live-preview-content .character-description');
        const previewSidebar = document.getElementById('live-preview-sidebar');

        if (contentWidthSlider && contentWidthLabel && previewContent) {
            contentWidthSlider.addEventListener('input', (event) => {
                const newWidth = event.target.value;
                previewContent.style.maxWidth = `${newWidth}px`;
                contentWidthLabel.textContent = `${newWidth}px`;
            });
        }

        if (panelWidthSlider && panelWidthLabel && previewSidebar) {
            panelWidthSlider.addEventListener('input', (event) => {
                const newWidth = event.target.value;
                previewSidebar.style.width = `${newWidth}px`;
                panelWidthLabel.textContent = `${newWidth}px`;
            });
        }

        console.log("F-List Live Preview script is active.");
    }

    waitForElementAndRun();
})();