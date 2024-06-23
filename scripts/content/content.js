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

const customEvents = {
    onURLChange: (cb = () => { }) => {
        let lastUrl = document.URL;

        // observer to handle url changes
        const observer = new MutationObserver(async () => {
            let currentUrl = document.URL;

            // if url changed call `cb`
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;

                await cb?.()
            }
        });

        // observe changing document tree
        observer.observe(document, { subtree: true, childList: true });
    }
}

let latestVersion;
let existingVersion;
let isFabricPromptEnabled;
let outputMarkdown;
let patterns;
let activePattern;
let activePatternPrompt;

async function setupExtension() {
    // version info config
    latestVersion = await fetchVersion(CONFIG.FETCH_VERSIONS_URL).catch(() => null);
    existingVersion = await readFromStorage(CONFIG.STORAGE_KEYS.FABRIC_VERSION)
    if (!existingVersion && latestVersion) {
        await writeToStorage(CONFIG.STORAGE_KEYS.FABRIC_VERSION, latestVersion)
        existingVersion = latestVersion
    }

    // extension settings config
    isFabricPromptEnabled = await readFromStorage(CONFIG.STORAGE_KEYS.PATTERNS_ENABLED)
    if (typeof isFabricPromptEnabled !== 'boolean') {
        await writeToStorage(CONFIG.STORAGE_KEYS.PATTERNS_ENABLED, false)
        isFabricPromptEnabled = false
    }
    outputMarkdown = await readFromStorage(CONFIG.STORAGE_KEYS.OUTPUT_AS_MARKDOWN)
    if (typeof outputMarkdown !== 'boolean') {
        await writeToStorage(CONFIG.STORAGE_KEYS.OUTPUT_AS_MARKDOWN, true)
        outputMarkdown = true
    }
    patterns = await readFromStorage(CONFIG.STORAGE_KEYS.PATTERNS)
    if (!patterns) patterns = await updateFabricPatternsInfo()
    activePattern = await readFromStorage(CONFIG.STORAGE_KEYS.ACTIVE_PATTERN) || patterns[0]
    activePatternPrompt = activePattern ? await readFromStorage(CONFIG.STORAGE_KEYS.PATTERN_SYSTEM_COMMAND(activePattern)) : ''

    // create shadow dom for extension
    const extensionRoot = document.createElement('div')
    const extensionShadowDOM = extensionRoot.attachShadow({ mode: 'open' });
    const shadowDOMTemplateResponse = await fetch(chrome.runtime.getURL('scripts/content/settings-modal.html'))
    extensionShadowDOM.innerHTML = await shadowDOMTemplateResponse.text()

    // extension elements list
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
        fabricButton: (() => {
            const element = document.createElement('button')
            element.innerHTML = 'Ƒ'
            element.classList.add('fabric-button')
            return element;
        })()
    }

    // setup initial state of extension elements
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

    // attach event listeners to extension elements
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
    const toggleModal = (shouldDisplay) => {
        if (shouldDisplay) document.body.appendChild(extensionRoot);
        else document.body.removeChild(extensionRoot);
    }
    extensionElements.modal.addEventListener('click', (event) => {
        const target = event.composedPath()[0] // .target is parent of shadow dom, use composed path
        if (target === extensionElements.modal) toggleModal(false)
    })
    extensionElements.modalCloseBtn.addEventListener('click', () => toggleModal(false))
    extensionElements.fabricButton.addEventListener('click', (event) => {
        event.preventDefault()
        toggleModal(true)
    })

    return { extensionElements }
}

async function mountExtensionToChatGPT({ extensionElements }) {
    // get chatgpt elements
    const chatGPTElements = {
        chatbox: document.getElementById('prompt-textarea'),
        sendbtn: document.querySelector('button[data-testid*="send-button"]')
    }

    // return if page doesn't have chatgpt elements
    if (!chatGPTElements.chatbox && !chatGPTElements.sendbtn) {
        return {}
    }

    // add extenion to chatgpt chatbox
    chatGPTElements.chatbox.parentNode.insertBefore(extensionElements.fabricButton, chatGPTElements.chatbox)

    let shouldPreventDefaultOnChatGPTPromptSubmit = true
    const sendBtnSubmitHandler = (e) => {
        // return early if button is of 'stop' variant
        const ATTR_dataTestId = chatGPTElements.sendbtn.getAttribute('data-testid') || ''
        if (ATTR_dataTestId.includes('stop')) {
            return
        }

        if (shouldPreventDefaultOnChatGPTPromptSubmit) {
            e.preventDefault();
            e.stopPropagation();
            if (isFabricPromptEnabled) {
                const activePrompt = outputMarkdown ? activePatternPrompt : activePatternPrompt.replaceAll('markdown', 'simple text (as you would normally respond without markdown)').replaceAll('Markdown', 'simple text (as you would normally respond without markdown)')
                chatGPTElements.chatbox.value = activePrompt + chatGPTElements.chatbox.value
            }
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

    // re-add events when markup changes
    let currentChildNodes = Array.from(chatGPTElements.chatbox.parentNode.childNodes);
    const chatboxParentObserver = new MutationObserver(function (mutationsList, observer) {
        for (let mutation of mutationsList) {
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

    return {
        unmount: () => {
            chatGPTElements.sendbtn.removeEventListener('click', sendBtnSubmitHandler)
            chatGPTElements.chatbox.removeEventListener('keydown', chatboxEnterKeyHandler, { capture: true })
            chatGPTElements.chatbox.removeEventListener('keyup', chatboxEnterKeyHandler, { capture: true })
            chatboxParentObserver.disconnect();
        }
    }
}

(async () => {
    try {
        let { extensionElements } = await setupExtension()

        let { unmount = null } = await mountExtensionToChatGPT({ extensionElements })

        const remountExtensionToChatGPT = async () => {
            await new Promise(r => setTimeout(r, 1000)) // HACK: wait for the new chatgpt elements to finish rendering
            if (unmount) unmount()
            const { unmount: newUmount = null } = await mountExtensionToChatGPT({ extensionElements })
            unmount = newUmount
        }

        // a url change remounts chatgpt elements, this requires remounting extension and event listeners for extension to work.
        customEvents.onURLChange(remountExtensionToChatGPT)
    } catch (error) {
        console.error(`Fabric extension error. If you are seeing this please file a bug report with the error details on https://github.com/huzaifa-99/fabric-browser-extension/issues/new.\nErrorInfo: `, error)
    }
})()
