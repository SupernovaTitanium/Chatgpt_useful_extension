class TimelineManager {
    constructor() {
        this.scrollContainer = null;
        this.conversationContainer = null;
        this.markers = [];
        this.activeTurnId = null;
        this.ui = { timelineBar: null, tooltip: null };
        this.isScrolling = false;

        this.mutationObserver = null;
        this.resizeObserver = null;
        this.intersectionObserver = null;
        this.themeObserver = null; // observe theme class changes to refresh geometry
        this.visibleUserTurns = new Set();
        this.onTimelineBarClick = null;
        this.onScroll = null;
        this.onTimelineBarOver = null;
        this.onTimelineBarOut = null;
        this.onTimelineBarFocusIn = null;
        this.onTimelineBarFocusOut = null;
        this.onWindowResize = null;
        this.onTimelineWheel = null;
        this.scrollRafId = null;
        this.lastActiveChangeTime = 0;
        this.minActiveChangeInterval = 120; // ms
        this.pendingActiveId = null;
        this.activeChangeTimer = null;
        this.tooltipHideDelay = 100;
        this.tooltipHideTimer = null;
        this.measureEl = null; // legacy DOM measurer (kept as fallback)
        this.truncateCache = new Map();
        this.measureCanvas = null;
        this.measureCtx = null;
        this.showRafId = null;
        // Long-canvas scrollable track (Linked mode)
        this.ui.track = null;
        this.ui.trackContent = null;
        this.scale = 1;
        this.contentHeight = 0;
        this.yPositions = [];
        this.visibleRange = { start: 0, end: -1 };
        this.firstUserTurnOffset = 0;
        this.contentSpanPx = 1;
        this.usePixelTop = false; // fallback when CSS var positioning is unreliable
        this._cssVarTopSupported = null;
        // Left-side slider (only controls timeline scroll)
        this.ui.slider = null;
        this.ui.sliderHandle = null;
        this.sliderDragging = false;
        this.sliderFadeTimer = null;
        this.sliderFadeDelay = 1000;
        this.sliderAlwaysVisible = false; // show slider persistently when scrollable
        this.onSliderDown = null;
        this.onSliderMove = null;
        this.onSliderUp = null;
        this.markersVersion = 0;
        // Debug perf
        this.debugPerf = false;
        try { this.debugPerf = (localStorage.getItem('chatgptTimelineDebugPerf') === '1'); } catch { }
        this.onVisualViewportResize = null;

        this.debouncedRecalculateAndRender = this.debounce(this.recalculateAndRenderMarkers, 350);

        // Star/Highlight feature state
        this.starred = new Set();
        this.markerMap = new Map();
        this.conversationId = this.extractConversationIdFromPath(location.pathname);
        // Long-press gesture state
        this.longPressDuration = 550; // ms
        this.longPressMoveTolerance = 6; // px
        this.longPressTimer = null;
        this.longPressTriggered = false;
        this.pressStartPos = null;
        this.pressTargetDot = null;
        this.suppressClickUntil = 0;
        // Cross-tab sync
        this.onStorage = null;
        // Selection explain feature
        this.selectionExplainState = {
            button: null,
            popup: null,
            model: 'fast',
            selectedText: '',
            anchorRect: null,
            turnId: null,
            articleElement: null,
            errorEl: null,
            pending: false,
            modelButtons: new Map(),
            snippetEl: null,
            sendButton: null,
            cancelButton: null
        };
        this.selectionExplainHandlers = {
            onMouseUp: null,
            onKeyUp: null,
            onSelectionChange: null,
            onScroll: null,
            onPointerDown: null,
            onWindowScroll: null,
            onResize: null,
            onOutsideClick: null
        };
        this.selectionExplainCheckTimer = null;
        this.selectionExplainInitialized = false;
        this.selectionExplainPositionRaf = null;
        this.selectionExplainModels = [
            {
                id: 'fast',
                label: 'Fast',
                description: 'Use a quick model for short clarifications.',
                optionSelector: '[data-testid="model-selector-option-gpt-4o-mini"], [data-testid="model-selector-option-gpt-4o-mini-free"]',
                labelPattern: /mini|fast|gpt-4o mini/i
            },
            {
                id: 'default',
                label: 'Default',
                description: 'Ask with the currently selected model.',
                optionSelector: null,
                labelPattern: null
            },
            {
                id: 'reasoning',
                label: 'Reasoning',
                description: 'Prefer deeper reasoning models when available.',
                optionSelector: '[data-testid="model-selector-option-o1-mini"], [data-testid="model-selector-option-o1-preview"], [data-testid="model-selector-option-o1"]',
                labelPattern: /o1|reason/i
            }
        ];
    }

    perfStart(name) {
        if (!this.debugPerf) return;
        try { performance.mark(`tg-${name}-start`); } catch { }
    }

    perfEnd(name) {
        if (!this.debugPerf) return;
        try {
            performance.mark(`tg-${name}-end`);
            performance.measure(`tg-${name}`, `tg-${name}-start`, `tg-${name}-end`);
            const entries = performance.getEntriesByName(`tg-${name}`).slice(-1)[0];
            if (entries) console.debug(`[TimelinePerf] ${name}: ${Math.round(entries.duration)}ms`);
        } catch { }
    }

    async init() {
        const elementsFound = await this.findCriticalElements();
        if (!elementsFound) return;

        this.injectTimelineUI();
        this.setupEventListeners();
        this.setupObservers();
        this.setupSelectionExplainFeature();
        // Force an immediate first build so dots appear without waiting for mutations
        try { this.recalculateAndRenderMarkers(); } catch { }
        // Load persisted star markers for current conversation
        this.conversationId = this.extractConversationIdFromPath(location.pathname);
        this.loadStars();
        // After loading stars, sync current markers/dots to reflect star state immediately
        try {
            for (let i = 0; i < this.markers.length; i++) {
                const m = this.markers[i];
                const want = this.starred.has(m.id);
                if (m.starred !== want) {
                    m.starred = want;
                    if (m.dotElement) {
                        try {
                            m.dotElement.classList.toggle('starred', m.starred);
                            m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
                        } catch { }
                    }
                }
            }
        } catch { }
        // Initial rendering will be triggered by observers; avoid duplicate delayed re-render
    }

    async findCriticalElements() {
        const firstTurn = await this.waitForElement('article[data-turn-id]');
        if (!firstTurn) return false;

        this.conversationContainer = firstTurn.parentElement;
        if (!this.conversationContainer) return false;

        let parent = this.conversationContainer;
        while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                this.scrollContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
        return this.scrollContainer !== null;
    }

    injectTimelineUI() {
        // Idempotent: ensure bar exists, then ensure track + content exist
        let timelineBar = document.querySelector('.chatgpt-timeline-bar');
        if (!timelineBar) {
            timelineBar = document.createElement('div');
            timelineBar.className = 'chatgpt-timeline-bar';
            document.body.appendChild(timelineBar);
        }
        this.ui.timelineBar = timelineBar;
        // Track + content
        let track = this.ui.timelineBar.querySelector('.timeline-track');
        if (!track) {
            track = document.createElement('div');
            track.className = 'timeline-track';
            this.ui.timelineBar.appendChild(track);
        }
        let trackContent = track.querySelector('.timeline-track-content');
        if (!trackContent) {
            trackContent = document.createElement('div');
            trackContent.className = 'timeline-track-content';
            track.appendChild(trackContent);
        }
        this.ui.track = track;
        this.ui.trackContent = trackContent;
        // Ensure external left-side slider exists (outside the bar)
        let slider = document.querySelector('.timeline-left-slider');
        if (!slider) {
            slider = document.createElement('div');
            slider.className = 'timeline-left-slider';
            const handle = document.createElement('div');
            handle.className = 'timeline-left-handle';
            slider.appendChild(handle);
            document.body.appendChild(slider);
        }
        this.ui.slider = slider;
        this.ui.sliderHandle = slider.querySelector('.timeline-left-handle');
        // Visibility will be controlled by updateSlider() based on scrollable state
        if (!this.ui.tooltip) {
            const tip = document.createElement('div');
            tip.className = 'timeline-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.id = 'chatgpt-timeline-tooltip';
            document.body.appendChild(tip);
            this.ui.tooltip = tip;
            // Hidden measurement node for legacy DOM truncation (fallback)
            if (!this.measureEl) {
                const m = document.createElement('div');
                m.setAttribute('aria-hidden', 'true');
                m.style.position = 'fixed';
                m.style.left = '-9999px';
                m.style.top = '0px';
                m.style.visibility = 'hidden';
                m.style.pointerEvents = 'none';
                const cs = getComputedStyle(tip);
                Object.assign(m.style, {
                    backgroundColor: cs.backgroundColor,
                    color: cs.color,
                    fontFamily: cs.fontFamily,
                    fontSize: cs.fontSize,
                    lineHeight: cs.lineHeight,
                    padding: cs.padding,
                    border: cs.border,
                    borderRadius: cs.borderRadius,
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    maxWidth: 'none',
                    display: 'block',
                    transform: 'none',
                    transition: 'none'
                });
                // Ensure no clamping interferes with measurement
                try { m.style.webkitLineClamp = 'unset'; } catch { }
                document.body.appendChild(m);
                this.measureEl = m;
            }
            // Create canvas for text layout based truncation (primary)
            if (!this.measureCanvas) {
                this.measureCanvas = document.createElement('canvas');
                this.measureCtx = this.measureCanvas.getContext('2d');
            }
        }
    }

    recalculateAndRenderMarkers() {
        this.perfStart('recalc');
        if (!this.conversationContainer || !this.ui.timelineBar || !this.scrollContainer) return;

        const userTurnElements = this.conversationContainer.querySelectorAll('article[data-turn="user"]');
        // Reset visible window to avoid cleaning with stale indices after rebuild
        this.visibleRange = { start: 0, end: -1 };
        // If the conversation is transiently empty (branch switching), don't wipe UI immediately
        if (userTurnElements.length === 0) {
            if (!this.zeroTurnsTimer) {
                this.zeroTurnsTimer = setTimeout(() => {
                    this.zeroTurnsTimer = null;
                    this.recalculateAndRenderMarkers();
                }, 350);
            }
            return;
        }
        if (this.zeroTurnsTimer) { try { clearTimeout(this.zeroTurnsTimer); } catch { } this.zeroTurnsTimer = null; }
        // Clear old dots from track/content (now that we know content exists)
        (this.ui.trackContent || this.ui.timelineBar).querySelectorAll('.timeline-dot').forEach(n => n.remove());

        let contentSpan;
        const firstTurnOffset = userTurnElements[0].offsetTop;
        if (userTurnElements.length < 2) {
            contentSpan = 1;
        } else {
            const lastTurnOffset = userTurnElements[userTurnElements.length - 1].offsetTop;
            contentSpan = lastTurnOffset - firstTurnOffset;
        }
        if (contentSpan <= 0) contentSpan = 1;

        // Cache for scroll mapping
        this.firstUserTurnOffset = firstTurnOffset;
        this.contentSpanPx = contentSpan;

        // Build markers with normalized position along conversation
        this.markerMap.clear();
        this.markers = Array.from(userTurnElements).map(el => {
            const offsetFromStart = el.offsetTop - firstTurnOffset;
            let n = offsetFromStart / contentSpan;
            n = Math.max(0, Math.min(1, n));
            const m = {
                id: el.dataset.turnId,
                element: el,
                summary: this.normalizeText(el.textContent || ''),
                n,
                baseN: n,
                dotElement: null,
                starred: false,
            };
            try { m.starred = this.starred.has(m.id); } catch { }
            this.markerMap.set(m.id, m);
            return m;
        });
        // Bump version after markers are rebuilt to invalidate concurrent passes
        this.markersVersion++;

        // Compute geometry and virtualize render
        this.updateTimelineGeometry();
        if (!this.activeTurnId && this.markers.length > 0) {
            this.activeTurnId = this.markers[this.markers.length - 1].id;
        }
        this.syncTimelineTrackToMain();
        this.updateVirtualRangeAndRender();
        // Ensure active class is applied after dots are created
        this.updateActiveDotUI();
        this.scheduleScrollSync();
        this.perfEnd('recalc');
    }

    setupSelectionExplainFeature() {
        if (this.selectionExplainInitialized) return;
        this.selectionExplainInitialized = true;
        const state = this.selectionExplainState;
        const handlers = this.selectionExplainHandlers;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'timeline-explain-button';
        trigger.textContent = 'Ask ChatGPT to explain';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.style.display = 'none';
        document.body.appendChild(trigger);
        state.button = trigger;

        const popup = document.createElement('div');
        popup.className = 'timeline-explain-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-modal', 'false');
        popup.style.display = 'none';

        const header = document.createElement('div');
        header.className = 'timeline-explain-popup-header';
        header.textContent = 'Ask for clarification';
        popup.appendChild(header);

        const modelTray = document.createElement('div');
        modelTray.className = 'timeline-explain-models';
        popup.appendChild(modelTray);

        state.modelButtons = new Map();
        this.selectionExplainModels.forEach((model) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'timeline-explain-model-btn';
            btn.dataset.modelId = model.id;
            btn.textContent = model.label;
            btn.title = model.description;
            if (model.id === state.model) btn.classList.add('active');
            btn.addEventListener('click', () => this.setSelectionExplainModel(model.id));
            state.modelButtons.set(model.id, btn);
            modelTray.appendChild(btn);
        });

        const snippetWrap = document.createElement('div');
        snippetWrap.className = 'timeline-explain-snippet';
        const snippetLabel = document.createElement('div');
        snippetLabel.className = 'timeline-explain-snippet-label';
        snippetLabel.textContent = 'Selected text';
        snippetWrap.appendChild(snippetLabel);
        const snippetBody = document.createElement('div');
        snippetBody.className = 'timeline-explain-snippet-body';
        snippetWrap.appendChild(snippetBody);
        popup.appendChild(snippetWrap);
        state.snippetEl = snippetBody;

        const errorEl = document.createElement('div');
        errorEl.className = 'timeline-explain-error';
        popup.appendChild(errorEl);
        state.errorEl = errorEl;

        const actions = document.createElement('div');
        actions.className = 'timeline-explain-actions';
        popup.appendChild(actions);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'timeline-explain-cancel';
        cancelBtn.textContent = 'Cancel';
        actions.appendChild(cancelBtn);
        state.cancelButton = cancelBtn;

        const askBtn = document.createElement('button');
        askBtn.type = 'button';
        askBtn.className = 'timeline-explain-send';
        askBtn.textContent = 'Ask';
        actions.appendChild(askBtn);
        state.sendButton = askBtn;

        document.body.appendChild(popup);
        state.popup = popup;

        trigger.addEventListener('click', () => this.openSelectionExplainPopup());
        askBtn.addEventListener('click', () => this.handleSelectionExplainSend());
        cancelBtn.addEventListener('click', () => {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
        });

        handlers.onMouseUp = () => this.scheduleSelectionExplainCheck();
        handlers.onKeyUp = (ev) => {
            const key = ev?.key || '';
            if (!key) return;
            if (key.startsWith('Arrow') || key === 'Shift' || key === 'Escape') {
                this.scheduleSelectionExplainCheck();
            }
        };
        handlers.onSelectionChange = () => this.scheduleSelectionExplainCheck();
        handlers.onScroll = () => this.hideSelectionExplainButton(false);
        handlers.onWindowScroll = () => this.hideSelectionExplainButton(false);
        handlers.onResize = () => this.hideSelectionExplainButton(false);
        handlers.onPointerDown = (ev) => {
            if (!state.popup || !state.button) return;
            const path = ev.composedPath();
            if (path.includes(state.popup) || path.includes(state.button)) return;
            this.hideSelectionExplainPopup();
        };
        handlers.onOutsideClick = (ev) => {
            const path = ev.composedPath();
            if (path.includes(state.popup) || path.includes(state.button)) return;
            this.hideSelectionExplainPopup();
        };

        document.addEventListener('mouseup', handlers.onMouseUp);
        document.addEventListener('keyup', handlers.onKeyUp);
        document.addEventListener('selectionchange', handlers.onSelectionChange);
        document.addEventListener('pointerdown', handlers.onPointerDown, true);
        document.addEventListener('click', handlers.onOutsideClick, true);
        if (this.scrollContainer) {
            this.scrollContainer.addEventListener('scroll', handlers.onScroll, { passive: true });
        }
        window.addEventListener('scroll', handlers.onWindowScroll, { passive: true });
        window.addEventListener('resize', handlers.onResize, { passive: true });
    }

    scheduleSelectionExplainCheck() {
        if (this.selectionExplainCheckTimer) {
            try { clearTimeout(this.selectionExplainCheckTimer); } catch { }
        }
        this.selectionExplainCheckTimer = setTimeout(() => {
            this.selectionExplainCheckTimer = null;
            this.refreshSelectionExplainButton();
        }, 60);
    }

    refreshSelectionExplainButton() {
        const sel = window.getSelection();
        const state = this.selectionExplainState;
        if (!sel || !sel.rangeCount || sel.isCollapsed) {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
            return;
        }
        const text = (sel.toString() || '').trim();
        if (!text) {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
            return;
        }
        const range = sel.getRangeAt(0);
        let rect = null;
        try { rect = range.getBoundingClientRect(); } catch { rect = null; }
        if (!rect || rect.width === 0 || rect.height === 0) {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
            return;
        }
        let anchorNode = sel.anchorNode;
        if (anchorNode && anchorNode.nodeType === Node.TEXT_NODE) {
            anchorNode = anchorNode.parentElement;
        }
        let article = anchorNode;
        while (article && article !== document.body) {
            if (article === state.popup || article === state.button) {
                return;
            }
            if (article.matches?.('article[data-turn-id]')) break;
            article = article.parentElement;
        }
        if (!article) {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
            return;
        }
        const turnAttr = (article.getAttribute('data-turn') || article.getAttribute('data-role') || '').toLowerCase();
        if (turnAttr === 'user') {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
            return;
        }
        state.selectedText = text;
        state.articleElement = article;
        state.turnId = article.getAttribute('data-turn-id') || null;
        state.anchorRect = rect;
        this.updateSelectionExplainPreview();
        this.positionSelectionExplainButton(rect);
        this.hideSelectionExplainPopup(false);
        this.showSelectionExplainButton();
    }

    showSelectionExplainButton() {
        const button = this.selectionExplainState.button;
        if (!button) return;
        if (button.style.display !== 'inline-flex') {
            button.style.display = 'inline-flex';
        }
        button.classList.add('visible');
    }

    positionSelectionExplainButton(rect) {
        const state = this.selectionExplainState;
        const button = state.button;
        if (!button) return;
        if (this.selectionExplainPositionRaf) {
            try { cancelAnimationFrame(this.selectionExplainPositionRaf); } catch { }
            this.selectionExplainPositionRaf = null;
        }
        button.style.display = 'inline-flex';
        button.style.visibility = 'hidden';
        button.style.top = '0px';
        button.style.left = '0px';
        this.selectionExplainPositionRaf = requestAnimationFrame(() => {
            const width = button.offsetWidth || 160;
            const height = button.offsetHeight || 36;
            let top = rect.top - height - 10;
            if (top < 10) {
                top = rect.bottom + 10;
            }
            let left = rect.left + (rect.width / 2) - (width / 2);
            const minLeft = 10;
            const maxLeft = Math.max(minLeft, window.innerWidth - width - 10);
            if (left < minLeft) left = minLeft;
            if (left > maxLeft) left = maxLeft;
            button.style.top = `${Math.round(top)}px`;
            button.style.left = `${Math.round(left)}px`;
            button.style.visibility = 'visible';
        });
    }

    hideSelectionExplainButton(clearSelection = false) {
        const state = this.selectionExplainState;
        const button = state.button;
        if (this.selectionExplainPositionRaf) {
            try { cancelAnimationFrame(this.selectionExplainPositionRaf); } catch { }
            this.selectionExplainPositionRaf = null;
        }
        if (button) {
            button.style.display = 'none';
            button.classList.remove('visible');
        }
        if (clearSelection) {
            try { window.getSelection()?.removeAllRanges(); } catch { }
        }
    }

    openSelectionExplainPopup() {
        const state = this.selectionExplainState;
        if (!state.popup || !state.button) return;
        if (!state.selectedText) return;
        this.updateSelectionExplainPreview();
        state.errorEl && (state.errorEl.textContent = '');
        state.pending = false;
        state.popup.classList.add('visible');
        state.popup.style.display = 'block';
        state.sendButton?.removeAttribute('disabled');
        this.selectionExplainModels.forEach((model) => {
            const btn = state.modelButtons?.get(model.id);
            if (!btn) return;
            if (model.id === state.model) btn.classList.add('active'); else btn.classList.remove('active');
        });
        // Position popup under the trigger by default
        const triggerRect = state.button.getBoundingClientRect();
        state.popup.style.visibility = 'hidden';
        state.popup.style.top = '0px';
        state.popup.style.left = '0px';
        requestAnimationFrame(() => {
            const width = state.popup.offsetWidth || 260;
            const height = state.popup.offsetHeight || 200;
            let top = triggerRect.bottom + 8;
            const bottomSpace = window.innerHeight - triggerRect.bottom - 16;
            if (bottomSpace < height && triggerRect.top > height + 16) {
                top = triggerRect.top - height - 8;
            }
            if (top < 10) top = 10;
            let left = triggerRect.left + (triggerRect.width / 2) - (width / 2);
            const minLeft = 10;
            const maxLeft = Math.max(minLeft, window.innerWidth - width - 10);
            if (left < minLeft) left = minLeft;
            if (left > maxLeft) left = maxLeft;
            state.popup.style.top = `${Math.round(top)}px`;
            state.popup.style.left = `${Math.round(left)}px`;
            state.popup.style.visibility = 'visible';
        });
    }

    hideSelectionExplainPopup(resetError = true) {
        const state = this.selectionExplainState;
        if (state.popup) {
            state.popup.style.display = 'none';
            state.popup.classList.remove('visible');
        }
        if (resetError && state.errorEl) state.errorEl.textContent = '';
        state.pending = false;
    }

    updateSelectionExplainPreview() {
        const state = this.selectionExplainState;
        if (!state.snippetEl) return;
        const text = (state.selectedText || '').trim();
        const truncated = text.length > 400 ? `${text.slice(0, 400)}…` : text;
        state.snippetEl.textContent = truncated;
    }

    setSelectionExplainModel(modelId) {
        const state = this.selectionExplainState;
        const target = this.selectionExplainModels.find(m => m.id === modelId);
        if (!target) return;
        state.model = target.id;
        this.selectionExplainModels.forEach((model) => {
            const btn = state.modelButtons?.get(model.id);
            if (!btn) return;
            if (model.id === target.id) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    async handleSelectionExplainSend() {
        const state = this.selectionExplainState;
        if (state.pending) return;
        if (!state.selectedText) return;
        state.pending = true;
        if (state.sendButton) state.sendButton.setAttribute('disabled', 'true');
        if (state.errorEl) state.errorEl.textContent = '';

        // Capture scroll position
        const scrollTop = this.scrollContainer ? this.scrollContainer.scrollTop : null;
        const scrollLeft = this.scrollContainer ? this.scrollContainer.scrollLeft : null;

        // Start aggressive scroll restoration
        this.scrollRestoreTimer = setInterval(() => {
            if (this.scrollContainer && scrollTop !== null) {
                this.scrollContainer.scrollTop = scrollTop;
                if (typeof scrollLeft === 'number') this.scrollContainer.scrollLeft = scrollLeft;
            }
        }, 50);

        try {
            const switched = await this.switchChatGPTModelIfNeeded(state.model);
            if (!switched && state.errorEl) {
                state.errorEl.textContent = 'Selected model is not available right now. Using the current model instead.';
            }

            // Send the prompt
            const ok = await this.sendExplainPrompt(state.selectedText, state.model);
            if (!ok) {
                throw new Error('Failed to send prompt');
            }

            // Switch popup to "Answering" mode
            this.setPopupToAnsweringState();

            // Monitor the response
            await this.monitorResponse((partialText) => {
                this.updatePopupAnswer(partialText);
            });

            // Done
            state.pending = false;
            state.sendButton?.removeAttribute('disabled');
            clearInterval(this.scrollRestoreTimer);

        } catch (err) {
            if (state.errorEl) {
                state.errorEl.textContent = 'Unable to complete request. Please retry.';
            }
            state.pending = false;
            state.sendButton?.removeAttribute('disabled');
            console.error('Explain request failed:', err);
            clearInterval(this.scrollRestoreTimer);
        }
    }

    setPopupToAnsweringState() {
        const state = this.selectionExplainState;
        // Clear previous content or hide snippet
        if (state.snippetEl) state.snippetEl.style.display = 'none';

        // Create or reuse answer container
        let answerEl = state.popup.querySelector('.timeline-explain-answer');
        if (!answerEl) {
            answerEl = document.createElement('div');
            answerEl.className = 'timeline-explain-answer markdown-body'; // Use markdown class if available
            answerEl.style.marginTop = '10px';
            answerEl.style.padding = '10px';
            answerEl.style.backgroundColor = '#f9f9f9';
            answerEl.style.borderRadius = '6px';
            answerEl.style.maxHeight = '300px';
            answerEl.style.overflowY = 'auto';
            answerEl.style.fontSize = '14px';
            answerEl.style.lineHeight = '1.5';
            // Insert before actions
            state.popup.insertBefore(answerEl, state.popup.lastElementChild);
        }
        answerEl.textContent = 'Thinking...';
        state.answerEl = answerEl;

        // Hide actions except Close
        if (state.sendButton) state.sendButton.style.display = 'none';
        if (state.cancelButton) state.cancelButton.textContent = 'Close';
    }

    updatePopupAnswer(text) {
        const state = this.selectionExplainState;
        if (state.answerEl) {
            state.answerEl.textContent = text;
            // Auto-scroll to bottom of answer
            state.answerEl.scrollTop = state.answerEl.scrollHeight;
        }
    }

    async monitorResponse(onUpdate) {
        // Wait for the new user turn to appear (it should be the last one)
        // Then wait for the assistant turn after it.

        // Actually, we just sent a message, so we expect a new assistant turn to appear at the bottom.
        // We need to find the *last* assistant turn.

        let assistantTurn = null;
        let retries = 0;

        while (!assistantTurn && retries < 50) {
            await new Promise(r => setTimeout(r, 200));
            const turns = document.querySelectorAll('article[data-turn-id]');
            if (turns.length > 0) {
                const last = turns[turns.length - 1];
                // Check if it's assistant
                const isUser = last.getAttribute('data-turn') === 'user' || last.querySelector('[data-message-author-role="user"]');
                if (!isUser) {
                    assistantTurn = last;
                }
            }
            retries++;
        }

        if (!assistantTurn) return;

        // Monitor its content
        let lastText = '';
        let stableCount = 0;

        while (true) {
            await new Promise(r => setTimeout(r, 100));
            const text = assistantTurn.innerText;

            if (text !== lastText) {
                lastText = text;
                onUpdate(text);
                stableCount = 0;
            } else {
                stableCount++;
            }

            // Check if generation is done (button changes from Stop to Regenerate/etc)
            // Or just timeout if stable for a long time
            if (stableCount > 20) break; // 2 seconds stable

            // Also check for "Stop generating" button disappearance
            const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
            if (!stopBtn && stableCount > 5) break;
        }
    }

    async switchChatGPTModelIfNeeded(modelId) {
        if (modelId === 'default') return true;
        const model = this.selectionExplainModels.find(m => m.id === modelId);
        if (!model || !model.optionSelector) return true;
        const switcher = document.querySelector('[data-testid="model-switcher-button"], [data-testid="model-switcher"]');
        if (!switcher) return false;
        const label = (switcher.textContent || '').trim();
        if (model.labelPattern && model.labelPattern.test(label)) return true;
        switcher.click();
        const option = await this.waitForElement(model.optionSelector);
        if (!option) {
            try { switcher.click(); } catch { }
            return false;
        }
        option.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        setTimeout(() => {
            try { document.body.click(); } catch { }
        }, 60);
        return true;
    }

    findComposerTextarea() {
        const selectors = [
            'form textarea#prompt-textarea',
            'form textarea[placeholder*="Message"]',
            'form textarea[placeholder*="Send"]',
            '[data-testid="conversation-composer"] textarea',
            '[data-testid="composer-textarea"]',
            'textarea[data-testid="conversation-composer-textarea"]',
            'textarea[data-id]',
            'textarea'
        ];
        for (let i = 0; i < selectors.length; i++) {
            const el = document.querySelector(selectors[i]);
            if (el && !el.disabled && el.offsetParent !== null) return el;
        }
        const editable = document.querySelector('[contenteditable="true"][data-testid="conversation-composer-textarea"], [contenteditable="true"][data-id="composer"]');
        return editable || null;
    }

    dispatchInput(el, value) {
        if (!el) return;
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
            el.value = value;
        } else {
            el.textContent = value;
        }
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        el.dispatchEvent(inputEvent);
    }

    async sendExplainPrompt(text, modelId) {
        const target = this.findComposerTextarea();
        if (!target) return false;
        const prompt = `Please explain the highlighted portion from earlier in this conversation:\n\n${text}\n\nFocus on the context directly above.`;
        this.dispatchInput(target, prompt);
        target.focus();
        const composer = target.closest('form') || document.querySelector('[data-testid="conversation-composer"]');
        let sendButton = null;
        if (composer) {
            sendButton = composer.querySelector('button[type="submit"]:not([disabled])');
            if (!sendButton) sendButton = composer.querySelector('button[data-testid="composer-send-button"]:not([disabled])');
        }
        if (!sendButton) {
            sendButton = document.querySelector('button[aria-label="Send message"]:not([disabled])');
        }
        if (sendButton) {
            sendButton.click();
            return true;
        }
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        target.dispatchEvent(enterDown);
        target.dispatchEvent(enterUp);
        return true;
    }

    restoreConversationScroll(scrollTop, scrollLeft) {
        const target = this.scrollContainer;
        if (!target) return;
        const apply = () => {
            target.scrollTop = scrollTop;
            if (typeof scrollLeft === 'number') target.scrollLeft = scrollLeft;
        };
        apply();
        setTimeout(apply, 80);
        setTimeout(apply, 260);
        setTimeout(apply, 800);
    }

    setupObservers() {
        this.mutationObserver = new MutationObserver(() => {
            try { this.ensureContainersUpToDate(); } catch { }
            this.debouncedRecalculateAndRender();
            this.updateIntersectionObserverTargets();
        });
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

        // Resize: update long-canvas geometry and virtualization
        this.resizeObserver = new ResizeObserver(() => {
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        });
        if (this.ui.timelineBar) {
            this.resizeObserver.observe(this.ui.timelineBar);
        }

        this.intersectionObserver = new IntersectionObserver(entries => {
            // Maintain which user turns are currently visible
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) {
                    this.visibleUserTurns.add(target);
                } else {
                    this.visibleUserTurns.delete(target);
                }
            });

            // Defer active state decision to scroll-based computation
            this.scheduleScrollSync();
        }, {
            root: this.scrollContainer,
            threshold: 0.1,
            rootMargin: "-40% 0px -59% 0px"
        });

        this.updateIntersectionObserverTargets();

        // Observe theme toggles (e.g., html.dark) to refresh geometry immediately
        try {
            if (!this.themeObserver) {
                this.themeObserver = new MutationObserver(() => {
                    this.updateTimelineGeometry();
                    this.syncTimelineTrackToMain();
                    this.updateVirtualRangeAndRender();
                });
            }
            this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        } catch { }
    }

    setupAutoRename() {
        // Check if button already exists
        if (document.querySelector('.chatgpt-auto-rename-btn')) return;

        const headerSelector = '.sticky.top-0.z-10'; // Adjust selector based on ChatGPT DOM
        // Wait for header to appear if not present
        const header = document.querySelector(headerSelector);

        if (header) {
            this.injectRenameButton(header);
        } else {
            // Retry or observe
            setTimeout(() => {
                const h = document.querySelector(headerSelector);
                if (h) this.injectRenameButton(h);
            }, 2000);
        }

        // Listen for summary update
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'update_title') {
                this.updateChatTitle(request.summary);
            }
        });
    }

    injectRenameButton(header) {
        if (document.querySelector('.chatgpt-auto-rename-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'chatgpt-auto-rename-btn btn relative btn-neutral btn-small flex h-9 w-9 items-center justify-center rounded-lg border';
        btn.innerHTML = '<span>🖊️</span>'; // Icon
        btn.title = 'Auto Rename Chat';
        btn.style.position = 'absolute';
        btn.style.right = '60px'; // Adjust position
        btn.style.top = '10px';
        btn.style.zIndex = '100';

        btn.addEventListener('click', () => this.triggerAutoRename());

        header.appendChild(btn);
    }

    triggerAutoRename() {
        // Scrape chat content
        const turns = Array.from(document.querySelectorAll('article[data-turn-id]'));
        const textContent = turns.map(t => t.innerText).join('\n\n');

        if (!textContent) {
            alert('No content to summarize!');
            return;
        }

        // Send to background
        chrome.runtime.sendMessage({
            action: 'create_chat_and_summarize',
            content: textContent
        });
    }

    updateChatTitle(newTitle) {
        // This is tricky as ChatGPT uses React internal state.
        // We might need to simulate clicks or find the title input.
        // For now, let's try to find the title element and click "Rename" if possible,
        // or just alert the user with the new title.

        console.log('New Title Suggested:', newTitle);
        alert(`Suggested Title: ${newTitle}\n\n(Copy this and rename manually for now, as direct DOM manipulation of React state is unstable)`);

        // TODO: Implement robust renaming if possible
    }

    setupFolders() {
        // Inject Folder UI into sidebar
        // This requires finding the sidebar nav
        const nav = document.querySelector('nav');
        if (!nav) {
            setTimeout(() => this.setupFolders(), 1000);
            return;
        }

        // Create Folder Container
        if (document.getElementById('chatgpt-folder-container')) return;

        const container = document.createElement('div');
        container.id = 'chatgpt-folder-container';
        container.className = 'px-2 py-2';

        // Add "New Folder" button
        const addBtn = document.createElement('button');
        addBtn.textContent = '+ New Folder';
        addBtn.className = 'text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 mb-2 w-full text-left px-2';
        addBtn.addEventListener('click', () => {
            const name = prompt('Folder Name:');
            if (name) {
                this.folderManager.createFolder(name);
                this.renderFolders();
            }
        });
        container.appendChild(addBtn);

        // Folder List
        const list = document.createElement('div');
        list.id = 'chatgpt-folder-list';
        container.appendChild(list);

        // Insert before the chat history list (usually the second child of nav or similar)
        // We need to be careful not to break existing layout.
        // Let's try inserting at the top of nav for now.
        nav.insertBefore(container, nav.firstChild);

        this.renderFolders();
        // Subscribe to changes
        this.folderManager.subscribe(() => this.renderFolders());
    }

    setupPrompts() {
        // Inject Prompt Button into Composer
        // We need to find the composer area
        const composer = document.querySelector('form') || document.querySelector('[data-testid="conversation-composer"]');
        if (!composer) {
            setTimeout(() => this.setupPrompts(), 1000);
            return;
        }

        if (document.getElementById('chatgpt-prompt-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'chatgpt-prompt-btn';
        btn.type = 'button';
        btn.className = 'absolute bottom-2 right-12 p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
        btn.innerHTML = '<span>⚡</span>'; // Bolt icon
        btn.title = 'Prompt Toolbox';
        btn.style.zIndex = '20';

        // Position relative to composer
        // Actually, let's float it near the input
        const textarea = this.findComposerTextarea();
        if (textarea) {
            textarea.parentElement.appendChild(btn);
        } else {
            composer.appendChild(btn);
        }

        btn.addEventListener('click', () => this.togglePromptModal());
    }

    togglePromptModal() {
        let modal = document.getElementById('chatgpt-prompt-modal');
        if (modal) {
            modal.remove();
            return;
        }

        modal = document.createElement('div');
        modal.id = 'chatgpt-prompt-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';

        const content = document.createElement('div');
        content.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col p-4';
        modal.appendChild(content);

        // Header
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center mb-4';
        header.innerHTML = '<h3 class="text-lg font-bold">Prompt Toolbox</h3>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.onclick = () => modal.remove();
        header.appendChild(closeBtn);
        content.appendChild(header);

        // List
        const list = document.createElement('div');
        list.className = 'flex-1 overflow-y-auto mb-4 space-y-2';
        this.promptManager.prompts.forEach(p => {
            const item = document.createElement('div');
            item.className = 'p-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer';
            item.innerHTML = `<div class="font-bold">${p.title}</div><div class="text-xs text-gray-500 truncate">${p.content}</div>`;
            item.onclick = () => {
                this.insertPrompt(p.content);
                modal.remove();
            };
            list.appendChild(item);
        });
        content.appendChild(list);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'flex gap-2';

        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import';
        importBtn.className = 'btn btn-neutral btn-small';
        importBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.promptManager.importPrompts(ev.target.result);
                    modal.remove();
                    this.togglePromptModal(); // Re-open to refresh
                };
                reader.readAsText(file);
            };
            input.click();
        };
        actions.appendChild(importBtn);

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export';
        exportBtn.className = 'btn btn-neutral btn-small';
        exportBtn.onclick = () => this.promptManager.exportPrompts();
        actions.appendChild(exportBtn);

        content.appendChild(actions);
        document.body.appendChild(modal);
    }

    insertPrompt(text) {
        const textarea = this.findComposerTextarea();
        if (textarea) {
            this.dispatchInput(textarea, text);
            textarea.focus();
        }
    }

    // Ensure our conversation/scroll containers are still current after DOM replacements
    ensureContainersUpToDate() {
        const first = document.querySelector('article[data-turn-id]');
        if (!first) return;
        const newConv = first.parentElement;
        if (newConv && newConv !== this.conversationContainer) {
            // Rebind observers and listeners to the new conversation root
            this.rebindConversationContainer(newConv);
        }
    }

    rebindConversationContainer(newConv) {
        // Detach old listeners
        if (this.scrollContainer && this.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
        }
        if (this.scrollContainer && this.selectionExplainHandlers.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.selectionExplainHandlers.onScroll); } catch { }
        }
        try { this.mutationObserver?.disconnect(); } catch { }
        try { this.intersectionObserver?.disconnect(); } catch { }
        try { this.themeObserver?.disconnect(); } catch { }

        this.conversationContainer = newConv;
        try {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(true);
            this.selectionExplainState.selectedText = '';
            this.selectionExplainState.articleElement = null;
            this.selectionExplainState.turnId = null;
        } catch { }

        // Find (or re-find) scroll container
        let parent = newConv;
        let newScroll = null;
        while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                newScroll = parent; break;
            }
            parent = parent.parentElement;
        }
        if (!newScroll) newScroll = document.scrollingElement || document.documentElement || document.body;
        this.scrollContainer = newScroll;
        // Reattach scroll listener
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });
        if (this.selectionExplainHandlers.onScroll) {
            this.scrollContainer.addEventListener('scroll', this.selectionExplainHandlers.onScroll, { passive: true });
        }

        // Recreate IntersectionObserver with new root
        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) { this.visibleUserTurns.add(target); }
                else { this.visibleUserTurns.delete(target); }
            });
            this.scheduleScrollSync();
        }, { root: this.scrollContainer, threshold: 0.1, rootMargin: "-40% 0px -59% 0px" });
        this.updateIntersectionObserverTargets();

        // Re-observe mutations on the new conversation container
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

        // Force a recalc right away to rebuild markers
        this.recalculateAndRenderMarkers();
    }

    updateIntersectionObserverTargets() {
        if (!this.intersectionObserver || !this.conversationContainer) return;
        this.intersectionObserver.disconnect();
        this.visibleUserTurns.clear();
        const userTurns = this.conversationContainer.querySelectorAll('article[data-turn="user"][data-turn-id]');
        userTurns.forEach(el => this.intersectionObserver.observe(el));
    }

    setupEventListeners() {
        this.onTimelineBarClick = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) {
                const now = Date.now();
                if (now < (this.suppressClickUntil || 0)) {
                    try { e.preventDefault(); e.stopPropagation(); } catch { }
                    return;
                }
                const targetId = dot.dataset.targetTurnId;
                const targetElement = this.conversationContainer.querySelector(`article[data-turn-id="${targetId}"]`);
                if (targetElement) {
                    // Only scroll; let scroll-based computation set active to avoid double-flash
                    this.smoothScrollTo(targetElement);
                }
            }
        };
        this.ui.timelineBar.addEventListener('click', this.onTimelineBarClick);
        // Long-press gesture on dots (delegated on bar)
        this.onPointerDown = (ev) => {
            const dot = ev.target.closest?.('.timeline-dot');
            if (!dot) return;
            if (typeof ev.button === 'number' && ev.button !== 0) return; // left button only
            this.cancelLongPress();
            this.pressTargetDot = dot;
            this.pressStartPos = { x: ev.clientX, y: ev.clientY };
            try { dot.classList.add('holding'); } catch { }
            this.longPressTriggered = false;
            this.longPressTimer = setTimeout(() => {
                this.longPressTimer = null;
                if (!this.pressTargetDot) return;
                const id = this.pressTargetDot.dataset.targetTurnId;
                this.toggleStar(id);
                this.longPressTriggered = true;
                this.suppressClickUntil = Date.now() + 350;
                // If tooltip is visible for this dot, refresh immediately to reflect ★ prefix change
                try { this.refreshTooltipForDot(this.pressTargetDot); } catch { }
                try { this.pressTargetDot.classList.remove('holding'); } catch { }
            }, this.longPressDuration);
        };
        this.onPointerMove = (ev) => {
            if (!this.pressTargetDot || !this.pressStartPos) return;
            const dx = ev.clientX - this.pressStartPos.x;
            const dy = ev.clientY - this.pressStartPos.y;
            if ((dx * dx + dy * dy) > (this.longPressMoveTolerance * this.longPressMoveTolerance)) {
                this.cancelLongPress();
            }
        };
        this.onPointerUp = () => { this.cancelLongPress(); };
        this.onPointerCancel = () => { this.cancelLongPress(); };
        this.onPointerLeave = (ev) => {
            const dot = ev.target.closest?.('.timeline-dot');
            if (dot && dot === this.pressTargetDot) this.cancelLongPress();
        };
        try {
            this.ui.timelineBar.addEventListener('pointerdown', this.onPointerDown);
            window.addEventListener('pointermove', this.onPointerMove, { passive: true });
            window.addEventListener('pointerup', this.onPointerUp, { passive: true });
            window.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
            this.ui.timelineBar.addEventListener('pointerleave', this.onPointerLeave);
        } catch { }
        // Listen to container scroll to keep marker active state in sync
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

        // Tooltip interactions (delegated)
        this.onTimelineBarOver = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        this.onTimelineBarOut = (e) => {
            const fromDot = e.target.closest('.timeline-dot');
            const toDot = e.relatedTarget?.closest?.('.timeline-dot');
            if (fromDot && !toDot) this.hideTooltip();
        };
        this.onTimelineBarFocusIn = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        this.onTimelineBarFocusOut = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.hideTooltip();
        };
        this.ui.timelineBar.addEventListener('mouseover', this.onTimelineBarOver);
        this.ui.timelineBar.addEventListener('mouseout', this.onTimelineBarOut);
        this.ui.timelineBar.addEventListener('focusin', this.onTimelineBarFocusIn);
        this.ui.timelineBar.addEventListener('focusout', this.onTimelineBarFocusOut);

        // Slider visibility on hover (time axis or slider itself) with stable refs
        // Define and persist handlers so we can remove them in destroy()
        this.onBarEnter = () => this.showSlider();
        this.onBarLeave = () => this.hideSliderDeferred();
        this.onSliderEnter = () => this.showSlider();
        this.onSliderLeave = () => this.hideSliderDeferred();
        try {
            this.ui.timelineBar.addEventListener('pointerenter', this.onBarEnter);
            this.ui.timelineBar.addEventListener('pointerleave', this.onBarLeave);
            if (this.ui.slider) {
                this.ui.slider.addEventListener('pointerenter', this.onSliderEnter);
                this.ui.slider.addEventListener('pointerleave', this.onSliderLeave);
            }
        } catch { }

        // Reposition tooltip on resize
        this.onWindowResize = () => {
            if (this.ui.tooltip?.classList.contains('visible')) {
                const activeDot = this.ui.timelineBar.querySelector('.timeline-dot:hover, .timeline-dot:focus');
                if (activeDot) {
                    // Re-run T0->T1 to avoid layout during animation
                    const tip = this.ui.tooltip;
                    tip.classList.remove('visible');
                    let fullText = (activeDot.getAttribute('aria-label') || '').trim();
                    try {
                        const id = activeDot.dataset.targetTurnId;
                        if (id && this.starred.has(id)) fullText = `★ ${fullText}`;
                    } catch { }
                    const p = this.computePlacementInfo(activeDot);
                    const layout = this.truncateToThreeLines(fullText, p.width, true);
                    tip.textContent = layout.text;
                    this.placeTooltipAt(activeDot, p.placement, p.width, layout.height);
                    if (this.showRafId !== null) {
                        try { cancelAnimationFrame(this.showRafId); } catch { }
                        this.showRafId = null;
                    }
                    this.showRafId = requestAnimationFrame(() => {
                        this.showRafId = null;
                        tip.classList.add('visible');
                    });
                }
            }
            // Update long-canvas geometry and virtualization
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        };
        window.addEventListener('resize', this.onWindowResize);
        // VisualViewport resize can fire on zoom on some platforms; schedule correction
        if (window.visualViewport) {
            this.onVisualViewportResize = () => {
                this.updateTimelineGeometry();
                this.syncTimelineTrackToMain();
                this.updateVirtualRangeAndRender();
            };
            try { window.visualViewport.addEventListener('resize', this.onVisualViewportResize); } catch { }
        }

        // Scroll wheel on the timeline controls the main scroll container (Linked mode)
        this.onTimelineWheel = (e) => {
            // Prevent page from attempting to scroll anything else
            try { e.preventDefault(); } catch { }
            const delta = e.deltaY || 0;
            this.scrollContainer.scrollTop += delta;
            // Keep markers in sync on next frame
            this.scheduleScrollSync();
            this.showSlider();
        };
        this.ui.timelineBar.addEventListener('wheel', this.onTimelineWheel, { passive: false });

        // Slider drag handlers
        this.onSliderDown = (ev) => {
            if (!this.ui.sliderHandle) return;
            try { this.ui.sliderHandle.setPointerCapture(ev.pointerId); } catch { }
            this.sliderDragging = true;
            this.showSlider();
            this.sliderStartClientY = ev.clientY;
            const rect = this.ui.sliderHandle.getBoundingClientRect();
            this.sliderStartTop = rect.top;
            this.onSliderMove = (e) => this.handleSliderDrag(e);
            this.onSliderUp = (e) => this.endSliderDrag(e);
            window.addEventListener('pointermove', this.onSliderMove);
            window.addEventListener('pointerup', this.onSliderUp, { once: true });
        };
        try { this.ui.sliderHandle?.addEventListener('pointerdown', this.onSliderDown); } catch { }

        // Cross-tab star sync via localStorage 'storage' event
        this.onStorage = (e) => {
            try {
                if (!e || e.storageArea !== localStorage) return;
                const cid = this.conversationId;
                if (!cid) return;
                const expectedKey = `chatgptTimelineStars:${cid}`;
                if (e.key !== expectedKey) return;

                // Parse new star set
                let nextArr = [];
                try { nextArr = JSON.parse(e.newValue || '[]') || []; } catch { nextArr = []; }
                const nextSet = new Set(nextArr.map(x => String(x)));

                // Fast no-op check: if sizes match and all entries exist, skip
                if (nextSet.size === this.starred.size) {
                    let same = true;
                    for (const id of this.starred) { if (!nextSet.has(id)) { same = false; break; } }
                    if (same) return;
                }

                // Apply to in-memory set
                this.starred = nextSet;

                // Update markers and any visible dots
                for (let i = 0; i < this.markers.length; i++) {
                    const m = this.markers[i];
                    const want = this.starred.has(m.id);
                    if (m.starred !== want) {
                        m.starred = want;
                        if (m.dotElement) {
                            try {
                                m.dotElement.classList.toggle('starred', m.starred);
                                m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
                            } catch { }
                        }
                    }
                }

                // If a tooltip is currently visible over any dot, refresh it to reflect ★
                try {
                    if (this.ui.tooltip?.classList.contains('visible')) {
                        const currentDot = this.ui.timelineBar.querySelector('.timeline-dot:hover, .timeline-dot:focus');
                        if (currentDot) this.refreshTooltipForDot(currentDot);
                    }
                } catch { }
            } catch { }
        };
        try { window.addEventListener('storage', this.onStorage); } catch { }
    }

    smoothScrollTo(targetElement, duration = 600) {
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const targetPosition = targetRect.top - containerRect.top + this.scrollContainer.scrollTop;
        const startPosition = this.scrollContainer.scrollTop;
        const distance = targetPosition - startPosition;
        let startTime = null;

        const animation = (currentTime) => {
            this.isScrolling = true;
            if (startTime === null) startTime = currentTime;
            const timeElapsed = currentTime - startTime;
            const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
            this.scrollContainer.scrollTop = run;
            if (timeElapsed < duration) {
                requestAnimationFrame(animation);
            } else {
                this.scrollContainer.scrollTop = targetPosition;
                this.isScrolling = false;
            }
        };
        requestAnimationFrame(animation);
    }

    easeInOutQuad(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }

    updateActiveDotUI() {
        this.markers.forEach(marker => {
            marker.dotElement?.classList.toggle('active', marker.id === this.activeTurnId);
        });
    }

    debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // Read numeric CSS var from the timeline bar element
    getCSSVarNumber(el, name, fallback) {
        const v = getComputedStyle(el).getPropertyValue(name).trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    }

    // Normalize whitespace and trim; remove leading SR-only prefixes like "You said:" / "你说："; no manual ellipsis
    normalizeText(text) {
        try {
            let s = String(text || '').replace(/\s+/g, ' ').trim();
            // Strip only if it appears at the very start
            s = s.replace(/^\s*(you\s*said\s*[:：]?\s*)/i, '');
            s = s.replace(/^\s*((你说|您说|你說|您說)\s*[:：]?\s*)/, '');
            return s;
        } catch {
            return '';
        }
    }

    getTrackPadding() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-track-padding', 12);
    }

    getMinGap() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-min-gap', 12);
    }

    // Enforce a minimum pixel gap between positions while staying within bounds
    applyMinGap(positions, minTop, maxTop, gap) {
        const n = positions.length;
        if (n === 0) return positions;
        const out = positions.slice();
        // Clamp first and forward pass (monotonic increasing)
        out[0] = Math.max(minTop, Math.min(positions[0], maxTop));
        for (let i = 1; i < n; i++) {
            const minAllowed = out[i - 1] + gap;
            out[i] = Math.max(positions[i], minAllowed);
        }
        // If last exceeds max, backward pass
        if (out[n - 1] > maxTop) {
            out[n - 1] = maxTop;
            for (let i = n - 2; i >= 0; i--) {
                const maxAllowed = out[i + 1] - gap;
                out[i] = Math.min(out[i], maxAllowed);
            }
            // Ensure first still within min
            if (out[0] < minTop) {
                out[0] = minTop;
                for (let i = 1; i < n; i++) {
                    const minAllowed = out[i - 1] + gap;
                    out[i] = Math.max(out[i], minAllowed);
                }
            }
        }
        // Final clamp
        for (let i = 0; i < n; i++) {
            if (out[i] < minTop) out[i] = minTop;
            if (out[i] > maxTop) out[i] = maxTop;
        }
        return out;
    }

    // (Removed) Idle min-gap reapply; ChatGPT keeps min-gap solely in updateTimelineGeometry

    showTooltipForDot(dot) {
        if (!this.ui.tooltip) return;
        try { if (this.tooltipHideTimer) { clearTimeout(this.tooltipHideTimer); this.tooltipHideTimer = null; } } catch { }
        // T0: compute + write geometry while hidden
        const tip = this.ui.tooltip;
        tip.classList.remove('visible');
        let fullText = (dot.getAttribute('aria-label') || '').trim();
        try {
            const id = dot.dataset.targetTurnId;
            if (id && this.starred.has(id)) {
                fullText = `★ ${fullText}`;
            }
        } catch { }
        const p = this.computePlacementInfo(dot);
        const layout = this.truncateToThreeLines(fullText, p.width, true);
        tip.textContent = layout.text;
        this.placeTooltipAt(dot, p.placement, p.width, layout.height);
        tip.setAttribute('aria-hidden', 'false');
        // T1: next frame add visible for non-geometric animation only
        if (this.showRafId !== null) {
            try { cancelAnimationFrame(this.showRafId); } catch { }
            this.showRafId = null;
        }
        this.showRafId = requestAnimationFrame(() => {
            this.showRafId = null;
            tip.classList.add('visible');
        });
    }

    hideTooltip(immediate = false) {
        if (!this.ui.tooltip) return;
        const doHide = () => {
            this.ui.tooltip.classList.remove('visible');
            this.ui.tooltip.setAttribute('aria-hidden', 'true');
            this.tooltipHideTimer = null;
        };
        if (immediate) return doHide();
        try { if (this.tooltipHideTimer) { clearTimeout(this.tooltipHideTimer); } } catch { }
        this.tooltipHideTimer = setTimeout(doHide, this.tooltipHideDelay);
    }

    placeTooltipAt(dot, placement, width, height) {
        if (!this.ui.tooltip) return;
        const tip = this.ui.tooltip;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const arrowOut = this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;

        let left;
        if (placement === 'left') {
            left = Math.round(dotRect.left - gap - width);
            if (left < viewportPad) {
                // Clamp within viewport: switch to right if impossible
                const altLeft = Math.round(dotRect.right + gap);
                if (altLeft + width <= vw - viewportPad) {
                    placement = 'right';
                    left = altLeft;
                } else {
                    // shrink width to fit
                    const fitWidth = Math.max(120, vw - viewportPad - altLeft);
                    left = altLeft;
                    width = fitWidth;
                }
            }
        } else {
            left = Math.round(dotRect.right + gap);
            if (left + width > vw - viewportPad) {
                const altLeft = Math.round(dotRect.left - gap - width);
                if (altLeft >= viewportPad) {
                    placement = 'left';
                    left = altLeft;
                } else {
                    const fitWidth = Math.max(120, vw - viewportPad - left);
                    width = fitWidth;
                }
            }
        }

        let top = Math.round(dotRect.top + dotRect.height / 2 - height / 2);
        top = Math.max(viewportPad, Math.min(vh - height - viewportPad, top));
        tip.style.width = `${Math.floor(width)}px`;
        tip.style.height = `${Math.floor(height)}px`;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        tip.setAttribute('data-placement', placement);
    }

    // Refresh the currently visible tooltip for a given dot in place (no hide/show flicker)
    refreshTooltipForDot(dot) {
        if (!this.ui?.tooltip || !dot) return;
        const tip = this.ui.tooltip;
        // Only update when tooltip is currently visible
        const isVisible = tip.classList.contains('visible');
        if (!isVisible) return;

        let fullText = (dot.getAttribute('aria-label') || '').trim();
        try {
            const id = dot.dataset.targetTurnId;
            if (id && this.starred.has(id)) fullText = `★ ${fullText}`;
        } catch { }
        const p = this.computePlacementInfo(dot);
        const layout = this.truncateToThreeLines(fullText, p.width, true);
        tip.textContent = layout.text;
        this.placeTooltipAt(dot, p.placement, p.width, layout.height);
    }

    // --- Long-canvas geometry and virtualization (Linked mode) ---
    updateTimelineGeometry() {
        if (!this.ui.timelineBar || !this.ui.trackContent) return;
        const H = this.ui.timelineBar.clientHeight || 0;
        const pad = this.getTrackPadding();
        const minGap = this.getMinGap();
        const N = this.markers.length;
        // Content height ensures minGap between consecutive dots
        const desired = Math.max(H, (N > 0 ? (2 * pad + Math.max(0, N - 1) * minGap) : H));
        this.contentHeight = Math.ceil(desired);
        this.scale = (H > 0) ? (this.contentHeight / H) : 1;
        try { this.ui.trackContent.style.height = `${this.contentHeight}px`; } catch { }

        // Precompute desired Y from normalized baseN and enforce min-gap
        const usableC = Math.max(1, this.contentHeight - 2 * pad);
        const desiredY = this.markers.map(m => pad + Math.max(0, Math.min(1, (m.baseN ?? m.n ?? 0))) * usableC);
        const adjusted = this.applyMinGap(desiredY, pad, pad + usableC, minGap);
        this.yPositions = adjusted;
        // Update normalized n for CSS positioning
        for (let i = 0; i < N; i++) {
            const top = adjusted[i];
            const n = (top - pad) / usableC;
            this.markers[i].n = Math.max(0, Math.min(1, n));
            if (this.markers[i].dotElement && !this.usePixelTop) {
                try { this.markers[i].dotElement.style.setProperty('--n', String(this.markers[i].n)); } catch { }
            }
        }
        if (this._cssVarTopSupported === null) {
            this._cssVarTopSupported = this.detectCssVarTopSupport(pad, usableC);
            this.usePixelTop = !this._cssVarTopSupported;
        }
        this.updateSlider();
        // First-time nudge: if content is scrollable, briefly reveal slider
        const barH = this.ui.timelineBar?.clientHeight || 0;
        if (this.contentHeight > barH + 1) {
            this.sliderAlwaysVisible = true;
            this.showSlider();
        } else {
            this.sliderAlwaysVisible = false;
        }
    }

    detectCssVarTopSupport(pad, usableC) {
        try {
            if (!this.ui.trackContent) return false;
            const test = document.createElement('button');
            test.className = 'timeline-dot';
            test.style.visibility = 'hidden';
            test.style.pointerEvents = 'none';
            test.setAttribute('aria-hidden', 'true');
            const expected = pad + 0.5 * usableC;
            test.style.setProperty('--n', '0.5');
            this.ui.trackContent.appendChild(test);
            const cs = getComputedStyle(test);
            const topStr = cs.top || '';
            const px = parseFloat(topStr);
            test.remove();
            if (!Number.isFinite(px)) return false;
            return Math.abs(px - expected) <= 2;
        } catch {
            return false;
        }
    }

    syncTimelineTrackToMain() {
        if (this.sliderDragging) return; // do not override when user drags slider
        if (!this.ui.track || !this.scrollContainer || !this.contentHeight) return;
        const scrollTop = this.scrollContainer.scrollTop;
        const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;
        const span = Math.max(1, this.contentSpanPx || 1);
        const r = Math.max(0, Math.min(1, (ref - (this.firstUserTurnOffset || 0)) / span));
        const maxScroll = Math.max(0, this.contentHeight - (this.ui.track.clientHeight || 0));
        const target = Math.round(r * maxScroll);
        if (Math.abs((this.ui.track.scrollTop || 0) - target) > 1) {
            this.ui.track.scrollTop = target;
        }
    }

    updateVirtualRangeAndRender() {
        const localVersion = this.markersVersion;
        if (!this.ui.track || !this.ui.trackContent || this.markers.length === 0) return;
        const st = this.ui.track.scrollTop || 0;
        const vh = this.ui.track.clientHeight || 0;
        const buffer = Math.max(100, vh);
        const minY = st - buffer;
        const maxY = st + vh + buffer;
        const start = this.lowerBound(this.yPositions, minY);
        const end = Math.max(start - 1, this.upperBound(this.yPositions, maxY));

        let prevStart = this.visibleRange.start;
        let prevEnd = this.visibleRange.end;
        const len = this.markers.length;
        // Clamp previous indices into current bounds to avoid undefined access
        if (len > 0) {
            prevStart = Math.max(0, Math.min(prevStart, len - 1));
            prevEnd = Math.max(-1, Math.min(prevEnd, len - 1));
        }
        if (prevEnd >= prevStart) {
            for (let i = prevStart; i < Math.min(start, prevEnd + 1); i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch { } m.dotElement = null; }
            }
            for (let i = Math.max(end + 1, prevStart); i <= prevEnd; i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch { } m.dotElement = null; }
            }
        } else {
            (this.ui.trackContent || this.ui.timelineBar).querySelectorAll('.timeline-dot').forEach(n => n.remove());
            this.markers.forEach(m => { m.dotElement = null; });
        }

        const frag = document.createDocumentFragment();
        for (let i = start; i <= end; i++) {
            const marker = this.markers[i];
            if (!marker) continue;
            if (!marker.dotElement) {
                const dot = document.createElement('button');
                dot.className = 'timeline-dot';
                dot.dataset.targetTurnId = marker.id;
                dot.setAttribute('aria-label', marker.summary);
                dot.setAttribute('tabindex', '0');
                try { dot.setAttribute('aria-describedby', 'chatgpt-timeline-tooltip'); } catch { }
                try { dot.style.setProperty('--n', String(marker.n || 0)); } catch { }
                if (this.usePixelTop) {
                    dot.style.top = `${Math.round(this.yPositions[i])}px`;
                }
                // Apply active state immediately if this is the active marker
                try { dot.classList.toggle('active', marker.id === this.activeTurnId); } catch { }
                // Apply starred state and aria
                try {
                    dot.classList.toggle('starred', !!marker.starred);
                    dot.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
                } catch { }
                marker.dotElement = dot;
                frag.appendChild(dot);
            } else {
                try { marker.dotElement.style.setProperty('--n', String(marker.n || 0)); } catch { }
                if (this.usePixelTop) {
                    marker.dotElement.style.top = `${Math.round(this.yPositions[i])}px`;
                }
                try {
                    marker.dotElement.classList.toggle('starred', !!marker.starred);
                    marker.dotElement.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
                } catch { }
            }
        }
        if (localVersion !== this.markersVersion) return; // stale pass, abort
        if (frag.childNodes.length) this.ui.trackContent.appendChild(frag);
        this.visibleRange = { start, end };
        // keep slider in sync with timeline scroll
        this.updateSlider();
    }

    lowerBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < x) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    upperBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) lo = mid + 1; else hi = mid;
        }
        return lo - 1;
    }

    // --- Left slider helpers ---
    updateSlider() {
        if (!this.ui.slider || !this.ui.sliderHandle) return;
        if (!this.contentHeight || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const pad = this.getTrackPadding();
        const innerH = Math.max(0, barH - 2 * pad);
        if (this.contentHeight <= barH + 1 || innerH <= 0) {
            this.sliderAlwaysVisible = false;
            try {
                this.ui.slider.classList.remove('visible');
                this.ui.slider.style.opacity = '';
            } catch { }
            return;
        }
        this.sliderAlwaysVisible = true;
        // External slider geometry (short rail centered on inner area)
        const railLen = Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const railTop = Math.round(barRect.top + pad + (innerH - railLen) / 2);
        const railLeftGap = 8; // px gap from bar's left edge
        const sliderWidth = 12; // matches CSS
        const left = Math.round(barRect.left - railLeftGap - sliderWidth);
        this.ui.slider.style.left = `${left}px`;
        this.ui.slider.style.top = `${railTop}px`;
        this.ui.slider.style.height = `${railLen}px`;

        const handleH = 22; // fixed concise handle
        const maxTop = Math.max(0, railLen - handleH);
        const range = Math.max(1, this.contentHeight - barH);
        const st = this.ui.track.scrollTop || 0;
        const r = Math.max(0, Math.min(1, st / range));
        const top = Math.round(r * maxTop);
        this.ui.sliderHandle.style.height = `${handleH}px`;
        this.ui.sliderHandle.style.top = `${top}px`;
        try {
            this.ui.slider.classList.add('visible');
            this.ui.slider.style.opacity = '';
        } catch { }
    }

    showSlider() {
        if (!this.ui.slider) return;
        this.ui.slider.classList.add('visible');
        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } this.sliderFadeTimer = null; }
        this.updateSlider();
    }

    hideSliderDeferred() {
        if (this.sliderDragging || this.sliderAlwaysVisible) return;
        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } }
        this.sliderFadeTimer = setTimeout(() => {
            this.sliderFadeTimer = null;
            try { this.ui.slider?.classList.remove('visible'); } catch { }
        }, this.sliderFadeDelay);
    }

    handleSliderDrag(e) {
        if (!this.sliderDragging || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const railLen = parseFloat(this.ui.slider.style.height || '0') || Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const handleH = this.ui.sliderHandle.getBoundingClientRect().height || 22;
        const maxTop = Math.max(0, railLen - handleH);
        const delta = e.clientY - this.sliderStartClientY;
        let top = Math.max(0, Math.min(maxTop, (this.sliderStartTop + delta) - (parseFloat(this.ui.slider.style.top) || 0)));
        const r = (maxTop > 0) ? (top / maxTop) : 0;
        const range = Math.max(1, this.contentHeight - barH);
        this.ui.track.scrollTop = Math.round(r * range);
        this.updateVirtualRangeAndRender();
        this.showSlider();
        this.updateSlider();
    }

    endSliderDrag(e) {
        this.sliderDragging = false;
        try { window.removeEventListener('pointermove', this.onSliderMove); } catch { }
        this.onSliderMove = null;
        this.onSliderUp = null;
        this.hideSliderDeferred();
    }

    computePlacementInfo(dot) {
        const tip = this.ui.tooltip || document.body;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        const arrowOut = this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;
        const maxW = this.getCSSVarNumber(tip, '--timeline-tooltip-max', 288);
        const minW = 160;
        const leftAvail = Math.max(0, dotRect.left - gap - viewportPad);
        const rightAvail = Math.max(0, vw - dotRect.right - gap - viewportPad);
        let placement = (rightAvail > leftAvail) ? 'right' : 'left';
        let avail = placement === 'right' ? rightAvail : leftAvail;
        // choose width tier for determinism
        const tiers = [280, 240, 200, 160];
        const hardMax = Math.max(minW, Math.min(maxW, Math.floor(avail)));
        let width = tiers.find(t => t <= hardMax) || Math.max(minW, Math.min(hardMax, 160));
        // if no tier fits (very tight), try switching side
        if (width < minW && placement === 'left' && rightAvail > leftAvail) {
            placement = 'right';
            avail = rightAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width = tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        } else if (width < minW && placement === 'right' && leftAvail >= rightAvail) {
            placement = 'left';
            avail = leftAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width = tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        }
        width = Math.max(120, Math.min(width, maxW));
        return { placement, width };
    }

    truncateToThreeLines(text, targetWidth, wantLayout = false) {
        try {
            if (!this.measureEl || !this.ui.tooltip) return wantLayout ? { text, height: 0 } : text;
            const tip = this.ui.tooltip;
            const lineH = this.getCSSVarNumber(tip, '--timeline-tooltip-lh', 18);
            const padY = this.getCSSVarNumber(tip, '--timeline-tooltip-pad-y', 10);
            const borderW = this.getCSSVarNumber(tip, '--timeline-tooltip-border-w', 1);
            const maxH = Math.round(3 * lineH + 2 * padY + 2 * borderW);
            const ell = '…';
            const el = this.measureEl;
            el.style.width = `${Math.max(0, Math.floor(targetWidth))}px`;

            // fast path: full text fits within 3 lines
            el.textContent = String(text || '').replace(/\s+/g, ' ').trim();
            let h = el.offsetHeight;
            if (h <= maxH) {
                return wantLayout ? { text: el.textContent, height: h } : el.textContent;
            }

            // binary search longest prefix that fits
            const raw = el.textContent;
            let lo = 0, hi = raw.length, ans = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                el.textContent = raw.slice(0, mid).trimEnd() + ell;
                h = el.offsetHeight;
                if (h <= maxH) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            const out = (ans >= raw.length) ? raw : (raw.slice(0, ans).trimEnd() + ell);
            el.textContent = out;
            h = el.offsetHeight;
            return wantLayout ? { text: out, height: Math.min(h, maxH) } : out;
        } catch {
            return wantLayout ? { text, height: 0 } : text;
        }
    }

    scheduleScrollSync() {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
            this.scrollRafId = null;
            // Sync long-canvas scroll and virtualized dots before computing active
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
            this.computeActiveByScroll();
            this.updateSlider();
        });
    }

    computeActiveByScroll() {
        if (!this.scrollContainer || this.markers.length === 0) return;
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const scrollTop = this.scrollContainer.scrollTop;
        const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;

        let activeId = this.markers[0].id;
        for (let i = 0; i < this.markers.length; i++) {
            const m = this.markers[i];
            const top = m.element.getBoundingClientRect().top - containerRect.top + scrollTop;
            if (top <= ref) {
                activeId = m.id;
            } else {
                break;
            }
        }
        if (this.activeTurnId !== activeId) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const since = now - this.lastActiveChangeTime;
            if (since < this.minActiveChangeInterval) {
                // Coalesce rapid changes during fast scrolling/layout shifts
                this.pendingActiveId = activeId;
                if (!this.activeChangeTimer) {
                    const delay = Math.max(this.minActiveChangeInterval - since, 0);
                    this.activeChangeTimer = setTimeout(() => {
                        this.activeChangeTimer = null;
                        if (this.pendingActiveId && this.pendingActiveId !== this.activeTurnId) {
                            this.activeTurnId = this.pendingActiveId;
                            this.updateActiveDotUI();
                            this.lastActiveChangeTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        }
                        this.pendingActiveId = null;
                    }, delay);
                }
            } else {
                this.activeTurnId = activeId;
                this.updateActiveDotUI();
                this.lastActiveChangeTime = now;
            }
        }
    }

    waitForElement(selector) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) return resolve(element);
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    try { observer.disconnect(); } catch { }
                    resolve(el);
                }
            });
            try { observer.observe(document.body, { childList: true, subtree: true }); } catch { }
            // Guard against long-lived observers on wrong pages
            setTimeout(() => { try { observer.disconnect(); } catch { } resolve(null); }, 5000);
        });
    }

    destroy() {
        try { this.mutationObserver?.disconnect(); } catch { }
        try { this.resizeObserver?.disconnect(); } catch { }
        try { this.intersectionObserver?.disconnect(); } catch { }
        this.visibleUserTurns.clear();
        if (this.ui.timelineBar && this.onTimelineBarClick) {
            try { this.ui.timelineBar.removeEventListener('click', this.onTimelineBarClick); } catch { }
        }
        try { window.removeEventListener('storage', this.onStorage); } catch { }
        try { this.ui.timelineBar?.removeEventListener('pointerdown', this.onPointerDown); } catch { }
        try { window.removeEventListener('pointermove', this.onPointerMove); } catch { }
        try { window.removeEventListener('pointerup', this.onPointerUp); } catch { }
        try { window.removeEventListener('pointercancel', this.onPointerCancel); } catch { }
        try { this.ui.timelineBar?.removeEventListener('pointerleave', this.onPointerLeave); } catch { }
        if (this.scrollContainer && this.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
        }
        if (this.ui.timelineBar) {
            try { this.ui.timelineBar.removeEventListener('mouseover', this.onTimelineBarOver); } catch { }
            try { this.ui.timelineBar.removeEventListener('mouseout', this.onTimelineBarOut); } catch { }
            try { this.ui.timelineBar.removeEventListener('focusin', this.onTimelineBarFocusIn); } catch { }
            try { this.ui.timelineBar.removeEventListener('focusout', this.onTimelineBarFocusOut); } catch { }
            try { this.ui.timelineBar.removeEventListener('wheel', this.onTimelineWheel); } catch { }
            // Remove hover handlers with stable refs
            try { this.ui.timelineBar?.removeEventListener('pointerenter', this.onBarEnter); } catch { }
            try { this.ui.timelineBar?.removeEventListener('pointerleave', this.onBarLeave); } catch { }
            try { this.ui.slider?.removeEventListener('pointerenter', this.onSliderEnter); } catch { }
            try { this.ui.slider?.removeEventListener('pointerleave', this.onSliderLeave); } catch { }
            this.onBarEnter = this.onBarLeave = this.onSliderEnter = this.onSliderLeave = null;
        }
        try { this.ui.sliderHandle?.removeEventListener('pointerdown', this.onSliderDown); } catch { }
        try { window.removeEventListener('pointermove', this.onSliderMove); } catch { }
        if (this.onWindowResize) {
            try { window.removeEventListener('resize', this.onWindowResize); } catch { }
        }
        if (this.onVisualViewportResize && window.visualViewport) {
            try { window.visualViewport.removeEventListener('resize', this.onVisualViewportResize); } catch { }
            this.onVisualViewportResize = null;
        }
        if (this.scrollRafId !== null) {
            try { cancelAnimationFrame(this.scrollRafId); } catch { }
            this.scrollRafId = null;
        }
        const explainHandlers = this.selectionExplainHandlers || {};
        try { document.removeEventListener('mouseup', explainHandlers.onMouseUp); } catch { }
        try { document.removeEventListener('keyup', explainHandlers.onKeyUp); } catch { }
        try { document.removeEventListener('selectionchange', explainHandlers.onSelectionChange); } catch { }
        try { document.removeEventListener('pointerdown', explainHandlers.onPointerDown, true); } catch { }
        try { document.removeEventListener('click', explainHandlers.onOutsideClick, true); } catch { }
        if (this.scrollContainer && explainHandlers.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', explainHandlers.onScroll); } catch { }
        }
        try { window.removeEventListener('scroll', explainHandlers.onWindowScroll); } catch { }
        try { window.removeEventListener('resize', explainHandlers.onResize); } catch { }
        const explainState = this.selectionExplainState || {};
        if (explainState.button) {
            try { explainState.button.remove(); } catch { }
        }
        if (explainState.popup) {
            try { explainState.popup.remove(); } catch { }
        }
        try { explainState.modelButtons?.clear(); } catch { }
        this.selectionExplainInitialized = false;
        this.selectionExplainPositionRaf = null;
        try { this.ui.timelineBar?.remove(); } catch { }
        try { this.ui.tooltip?.remove(); } catch { }
        try { this.measureEl?.remove(); } catch { }
        // Ensure external left slider is fully removed and not intercepting pointer events
        try {
            if (this.ui.slider) {
                try { this.ui.slider.style.pointerEvents = 'none'; } catch { }
                try { this.ui.slider.remove(); } catch { }
            }
            const straySlider = document.querySelector('.timeline-left-slider');
            if (straySlider) {
                try { straySlider.style.pointerEvents = 'none'; } catch { }
                try { straySlider.remove(); } catch { }
            }
        } catch { }
        this.ui.slider = null;
        this.ui.sliderHandle = null;
        this.ui = { timelineBar: null, tooltip: null };
        this.markers = [];
        this.activeTurnId = null;
        this.scrollContainer = null;
        this.conversationContainer = null;
        this.onTimelineBarClick = null;
        this.onTimelineBarOver = null;
        this.onTimelineBarOut = null;
        this.onTimelineBarFocusIn = null;
        this.onTimelineBarFocusOut = null;
        this.onScroll = null;
        this.onWindowResize = null;
        if (this.activeChangeTimer) {
            try { clearTimeout(this.activeChangeTimer); } catch { }
            this.activeChangeTimer = null;
        }
        if (this.tooltipHideTimer) {
            try { clearTimeout(this.tooltipHideTimer); } catch { }
            this.tooltipHideTimer = null;
        }

        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } this.sliderFadeTimer = null; }
        this.pendingActiveId = null;
    }

    // --- Star/Highlight helpers ---
    extractConversationIdFromPath(pathname = location.pathname) {
        try {
            const segs = String(pathname || '').split('/').filter(Boolean);
            const i = segs.indexOf('c');
            if (i === -1) return null;
            const slug = segs[i + 1];
            if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
            return null;
        } catch { return null; }
    }

    loadStars() {
        this.starred.clear();
        const cid = this.conversationId;
        if (!cid) return;
        try {
            const raw = localStorage.getItem(`chatgptTimelineStars:${cid}`);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) arr.forEach(id => this.starred.add(String(id)));
        } catch { }
    }

    saveStars() {
        const cid = this.conversationId;
        if (!cid) return;
        try { localStorage.setItem(`chatgptTimelineStars:${cid}`, JSON.stringify(Array.from(this.starred))); } catch { }
    }

    toggleStar(turnId) {
        const id = String(turnId || '');
        if (!id) return;
        if (this.starred.has(id)) this.starred.delete(id); else this.starred.add(id);
        this.saveStars();
        const m = this.markerMap.get(id);
        if (m) {
            m.starred = this.starred.has(id);
            if (m.dotElement) {
                try {
                    m.dotElement.classList.toggle('starred', m.starred);
                    m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
                } catch { }
                // If tooltip is visible and anchored to this dot, update immediately
                try { this.refreshTooltipForDot(m.dotElement); } catch { }
            }
        }
    }

    cancelLongPress() {
        if (this.longPressTimer) { try { clearTimeout(this.longPressTimer); } catch { } this.longPressTimer = null; }
        if (this.pressTargetDot) { try { this.pressTargetDot.classList.remove('holding'); } catch { } }
        this.pressTargetDot = null;
        this.pressStartPos = null;
        this.longPressTriggered = false;
    }
}


// --- Entry Point and SPA Navigation Handler ---
let timelineManagerInstance = null;
let currentUrl = location.href;
let initTimerId = null;            // cancellable delayed init
let pageObserver = null;           // page-level MutationObserver (managed)
let routeCheckIntervalId = null;   // lightweight href polling fallback
let routeListenersAttached = false;
let timelineActive = true;         // global on/off
let providerEnabled = true;        // per-provider on/off (chatgpt)

// Accept both /c/<id> and nested routes like /g/.../c/<id>
function isConversationRoute(pathname = location.pathname) {
    // Split path into segments and ensure there's an independent "c" segment
    const segs = pathname.split('/').filter(Boolean);
    const i = segs.indexOf('c');
    if (i === -1) return false;           // no "c" segment → not a conversation route
    const slug = segs[i + 1];             // the segment right after "c" must exist
    // Lightweight validity check: allow letters/digits/_/-
    return typeof slug === 'string' && slug.length > 0 && /^[A-Za-z0-9_-]+$/.test(slug);
}

function attachRouteListenersOnce() {
    if (routeListenersAttached) return;
    routeListenersAttached = true;
    try { window.addEventListener('popstate', handleUrlChange); } catch { }
    try { window.addEventListener('hashchange', handleUrlChange); } catch { }
    // Lightweight polling fallback for pushState-driven SPA changes
    try {
        routeCheckIntervalId = setInterval(() => {
            if (location.href !== currentUrl) handleUrlChange();
        }, 800);
    } catch { }
}

function detachRouteListeners() {
    if (!routeListenersAttached) return;
    routeListenersAttached = false;
    try { window.removeEventListener('popstate', handleUrlChange); } catch { }
    try { window.removeEventListener('hashchange', handleUrlChange); } catch { }
    try { if (routeCheckIntervalId) { clearInterval(routeCheckIntervalId); routeCheckIntervalId = null; } } catch { }
}

function cleanupGlobalObservers() {
    try { pageObserver?.disconnect(); } catch { }
    pageObserver = null;
}

function initializeTimeline() {
    if (timelineManagerInstance) {
        try { timelineManagerInstance.destroy(); } catch { }
        timelineManagerInstance = null;
    }
    // Remove any leftover UI before creating a new instance
    try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
    try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
    try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
    timelineManagerInstance = new TimelineManager();
    timelineManagerInstance.init().catch(err => console.error("Timeline initialization failed:", err));
}

function handleUrlChange() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;

    // Cancel any pending init from previous route
    try { if (initTimerId) { clearTimeout(initTimerId); initTimerId = null; } } catch { }

    if (isConversationRoute() && (timelineActive && providerEnabled)) {
        // Delay slightly to allow DOM to settle; re-check path before init
        initTimerId = setTimeout(() => {
            initTimerId = null;
            if (isConversationRoute() && (timelineActive && providerEnabled)) initializeTimeline();
        }, 300);
    } else {
        if (timelineManagerInstance) {
            try { timelineManagerInstance.destroy(); } catch { }
            timelineManagerInstance = null;
        }
        try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
        try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
        try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
        cleanupGlobalObservers();
    }
}

const initialObserver = new MutationObserver(() => {
    if (document.querySelector('article[data-turn-id]')) {
        if (isConversationRoute() && (timelineActive && providerEnabled)) { initializeTimeline(); }
        try { initialObserver.disconnect(); } catch { }
        // Create a single managed pageObserver
        pageObserver = new MutationObserver(handleUrlChange);
        try { pageObserver.observe(document.body, { childList: true, subtree: true }); } catch { }
        attachRouteListenersOnce();
    }
});
try { initialObserver.observe(document.body, { childList: true, subtree: true }); } catch { }

// Read initial toggles (new keys only) and react to changes
try {
    if (chrome?.storage?.local) {
        chrome.storage.local.get({ timelineActive: true, timelineProviders: {} }, (res) => {
            try { timelineActive = !!res.timelineActive; } catch { timelineActive = true; }
            try {
                const map = res.timelineProviders || {};
                providerEnabled = (typeof map.chatgpt === 'boolean') ? map.chatgpt : true;
            } catch { providerEnabled = true; }

            const enabled = timelineActive && providerEnabled;
            if (!enabled) {
                if (timelineManagerInstance) { try { timelineManagerInstance.destroy(); } catch { } timelineManagerInstance = null; }
                try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
                try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
                try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
            } else {
                if (isConversationRoute() && document.querySelector('article[data-turn-id]')) {
                    initializeTimeline();
                }
            }
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes) return;
            let changed = false;
            if ('timelineActive' in changes) {
                timelineActive = !!changes.timelineActive.newValue;
                changed = true;
            }
            if ('timelineProviders' in changes) {
                try {
                    const map = changes.timelineProviders.newValue || {};
                    providerEnabled = (typeof map.chatgpt === 'boolean') ? map.chatgpt : true;
                    changed = true;
                } catch { }
            }
            if (!changed) return;
            const enabled = timelineActive && providerEnabled;
            if (!enabled) {
                if (timelineManagerInstance) { try { timelineManagerInstance.destroy(); } catch { } timelineManagerInstance = null; }
                try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
                try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
                try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
            } else {
                if (isConversationRoute() && document.querySelector('article[data-turn-id]')) {
                    initializeTimeline();
                }
            }
        });
    }
} catch { }
