chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'fetchData') {
        fetch(request.url).then(response => {
            if (!response.ok) throw new Error('Error getting content');
            // github returns contents as a stream
            const reader = response.body.getReader();
            let chunks = [];
            
            function readChunk() {
                return reader.read().then(({
                    value,
                    done
                }) => {
                    if (done) return chunks.join('');
                    chunks.push(new TextDecoder().decode(value));
                    return readChunk();
                });
            }
            return readChunk();
        }).then(data => sendResponse({
            success: true,
            data: data
        })).catch(error => sendResponse({
            success: false,
            error: error.message
        }));
        return true;
    }
});
