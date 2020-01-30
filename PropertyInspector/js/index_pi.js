// this is our global websocket, used to communicate from/to Stream Deck software
// and some info about our plugin, as sent by Stream Deck software

var $localizedStrings = $localizedStrings || {};
var websocket = null,
debug = true,
uuid = null,
actionInfo = {},
DestinationEnum = Object.freeze({ 'HARDWARE_AND_SOFTWARE': 0, 'HARDWARE_ONLY': 1, 'SOFTWARE_ONLY': 2 });

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inUUID;
    applicationInfo = Utils.parseJson(inInfo);
    // please note: the incoming arguments are of type STRING, so
    // in case of the inActionInfo, we must parse it into JSON first
    actionInfo = JSON.parse(inActionInfo); // cache the info
    websocket = new WebSocket('ws://localhost:' + inPort);

    // if connection was established, the websocket sends
    // an 'onopen' event, where we need to register our PI
    websocket.onopen = function () {
        var json = {
            event:  inRegisterEvent,
            uuid:   inUUID
        };
        // register property inspector to Stream Deck
        websocket.send(JSON.stringify(json));
    }

    loadConfiguration(actionInfo.payload.settings);

    const lang = Utils.getProp(applicationInfo,'application.language', false);
    debugLog("lang:" , lang);
    if (lang) {
        loadLocalization(lang, inRegisterEvent === 'registerPropertyInspector' ? '../' : './', function() {
            if ($localizedStrings && Object.keys($localizedStrings).length > 0) {
                debugLog("localizeUI");
                localizeUI();
            }
        });
    }
}

function loadConfiguration(payload) {
    debugLog('loadConfiguration');
    debugLog(payload);
    for (var key in payload) {
        try {
            var elem = document.getElementById(key);
            if (elem.classList.contains("sdCheckbox")) { // Checkbox
                elem.checked = payload[key];
            }
            else if (elem.classList.contains("sdFile")) { // File
                var elemFile = document.getElementById(elem.id + "Filename");
                elemFile.innerText = payload[key];
                if (!elemFile.innerText) {
                    elemFile.innerText = "No file...";
                }
            }
            else if (elem.classList.contains("sdList")) { // Dynamic dropdown
                var textProperty = elem.getAttribute("sdListTextProperty");
                var valueProperty = elem.getAttribute("sdListValueProperty");
                var valueField = elem.getAttribute("sdValueField");

                var items = payload[key];
                elem.options.length = 0;

                for (var idx = 0; idx < items.length; idx++) {
                    var opt = document.createElement('option');
                    opt.value = items[idx][valueProperty];
                    opt.text = items[idx][textProperty];
                    elem.appendChild(opt);
                }
                elem.value = payload[valueField];
            }
            else { // Normal value
                elem.value = payload[key];
            }
            debugLog("Load: " + key + "=" + payload[key]);
        }
        catch (err) {
            debugLog("loadConfiguration failed for key: " + key + " - " + err);
        }
    }
}

function setSettings() {
    // getSoundUrl();
    debugLog("setSettings");
    var payload = {};
    var elements = document.getElementsByClassName("sdProperty");
    debugLog(elements);

    Array.prototype.forEach.call(elements, function (elem) {
        var key = elem.id;
        if (elem.classList.contains("sdCheckbox")) { // Checkbox
            payload[key] = elem.checked;
        }
        else if (elem.classList.contains("sdFile")) { // File
            var elemFile = document.getElementById(elem.id + "Filename");
            payload[key] = elem.value;
            if (!elem.value) {
                // Fetch innerText if file is empty (happens when we lose and regain focus to this key)
                payload[key] = elemFile.innerText;
            }
            else {
                // Set value on initial file selection
                elemFile.innerText = elem.value;
            }
        }
        else if (elem.classList.contains("sdList")) { // Dynamic dropdown
            var valueField = elem.getAttribute("sdValueField");
            payload[valueField] = elem.value;
        }
        else { // Normal value
            debugLog("Normal value");
            debugLog(key);
            debugLog(payload[key]);
            debugLog(elem);
            debugLog(elem.value);
            payload[key] = elem.value;
        }

        if (key == "myinstantsurl")
        {
            // debugLog(payload[key]);
            loadAndSetImage(payload[key]);
        }
        debugLog("Save: " + key + "<=" + payload[key]);
    });
    debugLog(payload);
    setSettings2(payload);
}

function setSettings2(payload) {
    if (websocket && (websocket.readyState === 1)) {
        debugLog(payload);
        const json = {
            'event': 'setSettings',
            'context': uuid,
            'payload': payload
        };
        websocket.send(JSON.stringify(json));
        var event = new Event('settingsUpdated');
        document.dispatchEvent(event);
    }
}

// our method to pass values to the plugin
function sendValueToPlugin(value, param) {
    if (websocket) {
        const json = {
            "action": actionInfo['action'],
            "event": "sendToPlugin",
            "context": uuid,
            "payload": {
                [param] : value
            }
        };
        websocket.send(JSON.stringify(json));
    }
}

function loadAndSetImage (imageNameOrArr) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', imageNameOrArr, true);
    xhr.responseType = "document";
    xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
            if (xhr.status === 200) {
                debugLog("test");
                var imgUrl = xhr.responseXML.querySelector("meta[property='og:image']").getAttribute('content');
                if(imgUrl == "https://www.myinstants.com/media/images/myinstants-opengraph.jpg")
                {
                    imgUrl = "https://www.myinstants.com/media/favicon-96x96.png";
                }
                else if(!imgUrl.endsWith(".94x94_q85_crop.png") && !imgUrl.endsWith(".94x94_q85_crop.jpg"))
                {
                    if(imgUrl.endsWith(".jpg"))
                    {
                        imgUrl = imgUrl + ".94x94_q85_crop.jpg";
                    }
                    else
                    {
                        imgUrl = imgUrl + ".94x94_q85_crop.png";
                    }
                }
                loadImage(imgUrl, function (data) {
                    debugLog(data);
                    sendValueToPlugin({
                        key: 'image',
                        value: data
                    }, 'sdpi_collection');
                });
                var soundTitle = xhr.responseXML.getElementById("content").getElementsByTagName('h1')[0].innerText;
                sendValueToPlugin({
                    key: 'title',
                    value: soundTitle
                }, 'sdpi_collection');
            }

        }
    };
    xhr.send();
};

function loadImage (inUrl, callback, inCanvas, inFillcolor) {
    /** Convert to array, so we may load multiple images at once */
    const aUrl = !Array.isArray(inUrl) ? [inUrl] : inUrl;
    const canvas = inCanvas && inCanvas instanceof HTMLCanvasElement
        ? inCanvas
        : document.createElement('canvas');
    var imgCount = aUrl.length - 1;
    const imgCache = {};

    var ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';

    for (let url of aUrl) {
        let image = new Image();
        let cnt = imgCount;
        let w = 144, h = 144;

        image.onload = function () {
            imgCache[url] = this;
            // look at the size of the first image
            if (url === aUrl[0]) {
                canvas.width = this.naturalWidth; // or 'width' if you want a special/scaled size
                canvas.height = this.naturalHeight; // or 'height' if you want a special/scaled size
            }
            // if (Object.keys(imgCache).length == aUrl.length) {
            if (cnt < 1) {
                if (inFillcolor) {
                    ctx.fillStyle = inFillcolor;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                // draw in the proper sequence FIFO
                aUrl.forEach(e => {
                    if (!imgCache[e]) {
                        console.warn(imgCache[e], imgCache);
                    }

                    if (imgCache[e]) {
                        ctx.drawImage(imgCache[e], 0, 0);
                        ctx.save();
                    }
                });

                debugLog(url);
                if(url.endsWith(".jpg"))
                {
                    debugLog("image/jpeg");
                    callback(canvas.toDataURL('image/jpeg'));
                }
                else
                {
                    debugLog("image/png");
                    callback(canvas.toDataURL('image/png'));
                }
                // or to get raw image data
                // callback && callback(canvas.toDataURL('image/png').replace(/^data:image\/(png|jpg);base64,/, ''));
            }
        };

        imgCount--;
        image.src = url;
    }
};

function openMyInstants() {
    window.xtWindow = window.open('index_pi_iframe.html', "MyInstants");
    window.xtWindow.addEventListener("DOMContentLoaded", windowLoaded, true);
    window.xtWindow.addEventListener("beforeunload", windowUnLoad, true);
}

function setURL(){
    debugLog(document.getElementById("myinstants_iFrame").contentWindow);
    var iframe = document.getElementById("myinstants_iFrame").contentWindow
    var url = iframe.location.href;
    if(url.startsWith("https://www.myinstants.com/instant"))
    {
        document.getElementById("myinstantsurl_hidden").value = url;
        document.getElementById("myinstantsaudiourl_hidden").value = iframe.document.querySelector("meta[property='og:audio']").getAttribute('content');
        this.close();
    }
}

function windowLoaded(event){
    localizeUI(event.currentTarget.document);
}

function windowUnLoad(event){
    if(typeof event.currentTarget !== "undefined")
    {
        if(typeof event.currentTarget.document.getElementById("myinstantsurl_hidden") !== "undefined" && event.currentTarget.document.getElementById("myinstantsurl_hidden") !== null)
        {
            var url = event.currentTarget.document.getElementById("myinstantsurl_hidden").value;
            if(url.startsWith("https://www.myinstants.com/instant")) {
                this.opener.document.getElementById("myinstantsurl").value = url;
                this.opener.document.getElementById("myinstantsaudiourl").value = event.currentTarget.document.getElementById("myinstantsaudiourl_hidden").value;
                setSettings();
            }
        }
    }
}

function testSound() {
    debugLog("testSound");
    var url = document.getElementById("myinstantsaudiourl").value;
    var audio = new Audio(url);
    audio.play();
}

function localize (s) {
    if (Utils.isUndefined(s)) return '';
    let str = String(s);
    try {
        str = $localizedStrings[str] || str;
    } catch (b) {}
    return str;
};

function _e (s) {
    return localize(s);
}

function localizeUI (doc = document) {
    const el = doc.querySelector('.sdpi-wrapper');
    Array.from(el.querySelectorAll('sdpi-item-label')).forEach(e => {
        e.innerHTML = e.innerHTML.replace(e.innerText, localize(e.innerText));
    });
    Array.from(el.querySelectorAll('*:not(script)')).forEach(e => {
        if (e.childNodes && e.childNodes.length > 0 && e.childNodes[0].nodeValue && typeof e.childNodes[0].nodeValue === 'string') {
            e.childNodes[0].nodeValue = localize(e.childNodes[0].nodeValue);
        }
    });
};