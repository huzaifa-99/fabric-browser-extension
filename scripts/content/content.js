const CONFIG = {
    STORAGE_KEYS: {
        FABRIC_VERSION: 'fabric-version',
        PATTERNS: 'patterns',
        PATTERN_SYSTEM_COMMAND: (name) => `pattern-${name}`,
        ACTIVE_PATTERN: 'active-pattern',
        PATTERNS_ENABLED: 'patterns-enabled',
        OUTPUT_AS_MARKDOWN: 'output-as-markdown',
    },
    FETCH_VERSIONS_URL: `https://github.com/danielmiessler/fabric/tags`,
    FABRIC_PATTERNS_URL: `https://github.com/danielmiessler/fabric/tree/main/patterns`,
    FABRIC_PATTERN_SYSTEM_URL: (pattern) => `https://raw.githubusercontent.com/danielmiessler/fabric/main/patterns/${pattern}/system.md`
}

async function fetchVersion(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchData', url }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.data, 'text/html');
                    const elements = doc.querySelectorAll('.commit h2[data-view-component="true"');
                    const elementsArray = Array.from(elements);
                    const versions = [...new Set(elementsArray.map((element) => element.textContent.trim()))].map(version => version.replace(/[a-zA-Z]/g, '')).sort((b, a) => a.localeCompare(b));
                    resolve(`v${versions[0]}`);
                } catch (error) {
                    reject(new Error('Error parsing versions from fabric => ', error))
                }
            }
        });
    });
}

async function fetchPatterns(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchData', url }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.data, 'text/html');
                    const elements = doc.getElementsByClassName('react-directory-truncate');
                    const elementsArray = Array.from(elements);
                    const patterns = [...new Set(elementsArray.map((element) => element.textContent.trim()))];
                    resolve(patterns);
                } catch (error) {
                    reject(new Error('Error parsing patterns from fabric => ', error))
                }
            }
        });
    });
}

async function fetchPatternSystemPrompt(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetchData', url }, response => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response.data)
        });
    });
}

async function readFromStorage(key) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(key, function (result) {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(result[key]);
        });
    });
}

async function writeToStorage(key, value) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, function () {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(true);
        });
    });
}

async function updateFabricPatternsInfo() {
    const patterns = await fetchPatterns(CONFIG.FABRIC_PATTERNS_URL)
    await writeToStorage(CONFIG.STORAGE_KEYS.PATTERNS, patterns)

    if (patterns?.length > 0) {
        await Promise.all(patterns.map(async pattern => {
            const systemcommand = await fetchPatternSystemPrompt(CONFIG.FABRIC_PATTERN_SYSTEM_URL(pattern))
            await writeToStorage(CONFIG.STORAGE_KEYS.PATTERN_SYSTEM_COMMAND(pattern), systemcommand)
        }))
    }

    return patterns
}

async function update(latestVersion) {
    await writeToStorage(CONFIG.STORAGE_KEYS.FABRIC_VERSION, latestVersion)

    let patterns = await updateFabricPatternsInfo()

    return { patterns }
}

async function setup() {
    const latestVersion = await fetchVersion(CONFIG.FETCH_VERSIONS_URL).catch(() => null);
    let existingVersion = await readFromStorage(CONFIG.STORAGE_KEYS.FABRIC_VERSION)
    if (!existingVersion && latestVersion) {
        await writeToStorage(CONFIG.STORAGE_KEYS.FABRIC_VERSION, latestVersion)
        existingVersion = latestVersion
    }

    let isFabricPromptEnabled = await readFromStorage(CONFIG.STORAGE_KEYS.PATTERNS_ENABLED)
    if (typeof isFabricPromptEnabled !== 'boolean') {
        await writeToStorage(CONFIG.STORAGE_KEYS.PATTERNS_ENABLED, false)
        isFabricPromptEnabled = false
    }

    let outputMarkdown = await readFromStorage(CONFIG.STORAGE_KEYS.OUTPUT_AS_MARKDOWN)
    if (typeof outputMarkdown !== 'boolean') {
        await writeToStorage(CONFIG.STORAGE_KEYS.OUTPUT_AS_MARKDOWN, true)
        outputMarkdown = true
    }

    let patterns = await readFromStorage(CONFIG.STORAGE_KEYS.PATTERNS)
    if (!patterns) patterns = await updateFabricPatternsInfo()

    const activePattern = await readFromStorage(CONFIG.STORAGE_KEYS.ACTIVE_PATTERN) || patterns[0]

    let activePatternPrompt = activePattern ? await readFromStorage(CONFIG.STORAGE_KEYS.PATTERN_SYSTEM_COMMAND(activePattern)) : ''

    return { existingVersion, latestVersion, isFabricPromptEnabled, outputMarkdown, patterns, activePattern, activePatternPrompt }
}

(async () => {
    try {
        let { latestVersion, existingVersion, isFabricPromptEnabled, outputMarkdown, patterns, activePattern, activePatternPrompt } = await setup()
    
        // adds extension to page
        const extensionRoot = document.createElement('div')
        const extensionShadowDOM = extensionRoot.attachShadow({ mode: 'open' });
        const shadowDOMTemplateResponse = await fetch(chrome.runtime.getURL('scripts/content/settings-modal.html'))
        extensionShadowDOM.innerHTML = await shadowDOMTemplateResponse.text()
    
        // get/create html elements
        const chatGPTElements = {
            chatbox: document.getElementById('prompt-textarea'),
            sendbtn: document.querySelector('button[data-testid*="send-button"]')
        }
        const extensionElements = {
            fabricVersionNumber: extensionShadowDOM.getElementById('fabric-version-number'),
            newVersionAvailable: extensionShadowDOM.getElementById('new-version-available'),
            newVersionNumber: extensionShadowDOM.getElementById('new-version-number'),
            updateVersionBtn: extensionShadowDOM.getElementById('update-version-button'),
            versionUpdateLoader: extensionShadowDOM.getElementById('version-update-loader'),
            modal: extensionShadowDOM.getElementById('settings-modal'),
            modalCloseBtn: extensionShadowDOM.getElementById('close-btn'),
            patternSelector: extensionShadowDOM.getElementById('patterns-selector'),
            patternsEnabledSwitch: extensionShadowDOM.getElementById('patterns-enabled-switch'),
            outputMarkdownSwitch: extensionShadowDOM.getElementById('output-markdown-switch'),
            activePromptLink: extensionShadowDOM.getElementById('active-prompt-link'),
        }
        const fabricButton = document.createElement('button')
        fabricButton.innerHTML = 'Ƒ'
        fabricButton.classList.add('fabric-button')
        chatGPTElements.chatbox.parentNode.insertBefore(fabricButton, chatGPTElements.chatbox)
    
        // setup initial state of html elements
        extensionElements.fabricVersionNumber.innerHTML = existingVersion
        if (latestVersion !== existingVersion) {
            extensionElements.newVersionAvailable.style.display = 'flex'
            extensionElements.newVersionNumber.innerText = extensionElements.newVersionNumber.innerText.replace('__NEW_VERSION__', latestVersion);
        }
        extensionElements.patternSelector.innerHTML = `${patterns.map(pattern => `<option value="${pattern}">${pattern}</option>`)}`
        extensionElements.patternSelector.disabled = !isFabricPromptEnabled
        if (activePattern) extensionElements.patternSelector.value = activePattern
        extensionElements.patternsEnabledSwitch.checked = isFabricPromptEnabled
        extensionElements.outputMarkdownSwitch.checked = outputMarkdown
        extensionElements.activePromptLink.href = CONFIG.FABRIC_PATTERN_SYSTEM_URL(activePattern)
    
        // attach events to html elements
        extensionElements.updateVersionBtn.addEventListener('click', async (e) => {
            extensionElements.updateVersionBtn.style.display = 'none'
    
            extensionElements.versionUpdateLoader.style.display = 'block';
            const { patterns: updatedPatterns } = await update(latestVersion)
            extensionElements.patternSelector.innerHTML = `${updatedPatterns.map(pattern => `<option value="${pattern}">${pattern}</option>`)}`
            patterns = updatedPatterns
            extensionElements.versionUpdateLoader.style.display = 'none';
    
            extensionElements.updateVersionBtn.style.display = 'flex'
            extensionElements.newVersionAvailable.style.display = 'none'
            extensionElements.fabricVersionNumber.innerHTML = latestVersion
        })
        extensionElements.patternSelector.addEventListener('change', async (e) => {
            const value = e.target.value.trim()
            await writeToStorage(CONFIG.STORAGE_KEYS.ACTIVE_PATTERN, value)
            activePattern = value
            activePatternPrompt = await readFromStorage(CONFIG.STORAGE_KEYS.PATTERN_SYSTEM_COMMAND(value))
            extensionElements.activePromptLink.href = CONFIG.FABRIC_PATTERN_SYSTEM_URL(activePattern)
        })
        extensionElements.patternsEnabledSwitch.addEventListener('change', async (e) => {
            const checked = e?.target?.checked || false
            await writeToStorage(CONFIG.STORAGE_KEYS.PATTERNS_ENABLED, checked)
            isFabricPromptEnabled = checked
            extensionElements.patternSelector.disabled = !isFabricPromptEnabled
        })
        extensionElements.outputMarkdownSwitch.addEventListener('change', async (e) => {
            const checked = e?.target?.checked || false
            await writeToStorage(CONFIG.STORAGE_KEYS.OUTPUT_AS_MARKDOWN, checked)
            outputMarkdown = checked
        })
        let isSettingsModalDisplayed = false
        const toggleModal = (shouldDisplay) => {
            if (shouldDisplay) chatGPTElements.chatbox.parentNode.appendChild(extensionRoot);
            else chatGPTElements.chatbox.parentNode.removeChild(extensionRoot);
            isSettingsModalDisplayed = shouldDisplay
        }
        extensionElements.modal.addEventListener('click', (event) => {
            const target = event.composedPath()[0] // .target is parent of shadow dom, use composed path
            if (target === extensionElements.modal) toggleModal(false)
        })
        extensionElements.modalCloseBtn.addEventListener('click', () => toggleModal(false))
        let shouldPreventDefaultOnChatGPTPromptSubmit = true
        const sendBtnSubmitHandler = (e) => {
            if (shouldPreventDefaultOnChatGPTPromptSubmit && isFabricPromptEnabled) {
                e.preventDefault();
                const activePrompt = outputMarkdown ? activePatternPrompt : activePatternPrompt.replaceAll('markdown', 'simple text (as you would normally respond)').replaceAll('Markdown', 'simple text (as you would normally respond)')
                chatGPTElements.chatbox.value = activePrompt + chatGPTElements.chatbox.value
                shouldPreventDefaultOnChatGPTPromptSubmit = !shouldPreventDefaultOnChatGPTPromptSubmit
                chatGPTElements.sendbtn.click()
            } else {
                shouldPreventDefaultOnChatGPTPromptSubmit = !shouldPreventDefaultOnChatGPTPromptSubmit
            }
        }
        chatGPTElements.sendbtn.addEventListener('click', sendBtnSubmitHandler)
        const chatboxEnterKeyHandler = (e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && chatGPTElements.chatbox.value.trim().length > 0) {
                e.preventDefault();
                e.stopPropagation()
                chatGPTElements.sendbtn.click()
            }
        }
        chatGPTElements.chatbox.addEventListener('keydown', chatboxEnterKeyHandler, { capture: true })
        chatGPTElements.chatbox.addEventListener('keyup', chatboxEnterKeyHandler, { capture: true })
        fabricButton.addEventListener('click', (event) => {
            event.preventDefault()
            toggleModal(true)
        })
    
        // re-add events when markup changes
        let currentChildNodes = Array.from(chatGPTElements.chatbox.parentNode.childNodes);
        const chatboxParentObserver = new MutationObserver(function (mutationsList, observer) {
            for (let mutation of mutationsList) {
                // console.log("mutation => ", mutation)
                if (mutation.type === 'childList') {
                    const newChildNodes = Array.from(chatGPTElements.chatbox.parentNode.childNodes);
    
                    // Compare currentChildNodes with newChildNodes to detect changes
                    const addedNodes = newChildNodes.filter(node => !currentChildNodes.includes(node));
                    const removedNodes = currentChildNodes.filter(node => !newChildNodes.includes(node));
    
                    if (addedNodes.length > 0 || removedNodes.length > 0) {
                        chatGPTElements.sendbtn = document.querySelector('button[data-testid*="send-button"]')
                        if (chatGPTElements.sendbtn) chatGPTElements.sendbtn.addEventListener('click', sendBtnSubmitHandler)
                    }
                }
            }
        });
        chatboxParentObserver.observe(chatGPTElements.chatbox.parentNode, { childList: true });
    } catch (error) {
        console.error(`Fabric extension error. If you are seeing this please file a bug report with the error details on https://github.com/huzaifa-99/fabric-browser-extension/issues/new.\nErrorInfo: `, error)
    }
})()
