// this is our global websocket, used to communicate from/to Stream Deck software
// and some info about our plugin, as sent by Stream Deck software
var websocket = null,
uuid = null,
actionInfo = {},
DestinationEnum = Object.freeze({ 'HARDWARE_AND_SOFTWARE': 0, 'HARDWARE_ONLY': 1, 'SOFTWARE_ONLY': 2 });;

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inUUID;
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
}

function loadConfiguration(payload) {
    console.log('loadConfiguration');
    console.log(payload);
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
            console.log("Load: " + key + "=" + payload[key]);
        }
        catch (err) {
            console.log("loadConfiguration failed for key: " + key + " - " + err);
        }
    }
}

function setSettings() {
    console.log("setSettings");
    var payload = {};
    var elements = document.getElementsByClassName("sdProperty");

    Array.prototype.forEach.call(elements, function (elem) {
        var key = elem.id;
        console.log(elem);
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
            payload[key] = elem.value;
        }

        if (key == "myinstantsurl")
        {
            // console.log(payload[key]);
            loadAndSetImage(payload[key]);
        }
        console.log("Save: " + key + "<=" + payload[key]);
    });
    setSettings2(payload);
}

function setSettings2(payload) {
    if (websocket && (websocket.readyState === 1)) {
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
                console.log("test");
                var imgUrl = xhr.responseXML.getElementById("content").getElementsByTagName('img')[0].src;
                if(!imgUrl.endsWith(".94x94_q85_crop.png") && !imgUrl.endsWith(".94x94_q85_crop.jpg"))
                {
                    if(imgUrl.endsWith(".jpg"))
                    {
                        imgUrl = imgUrl + ".94x94_q85_crop.jpg";
                    }
                    else
                    {
                        imgUrl = imgUrl + ".94x94_q85_crop.png";
                    }
                    loadImage(imgUrl, function (data) {
                        console.log(data);
                        
                        sendValueToPlugin({
                            key: 'image',
                            value: data
                        }, 'sdpi_collection');
                    });
                }
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

                console.log(url);
                if(url.endsWith(".jpg"))
                {
                    console.log("image/jpeg");
                    callback(canvas.toDataURL('image/jpeg'));
                }
                else
                {
                    console.log("image/png");
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
    window.xtWindow.addEventListener("beforeunload", windowUnLoad, true);
}

function setURL(){
    var url = document.getElementById("myinstants_iFrame").contentWindow.location.href;
    if(url.startsWith("https://www.myinstants.com/instant"))
    {
        document.getElementById("myinstantsurl_hidden").value = url;
        this.close();
    }
}

function windowUnLoad(event){
    if(typeof event.currentTarget !== "undefined")
    {
        if(typeof event.currentTarget.document.getElementById("myinstantsurl_hidden") !== "undefined" && event.currentTarget.document.getElementById("myinstantsurl_hidden") !== null)
        {
            var url = event.currentTarget.document.getElementById("myinstantsurl_hidden").value;
            if(url.startsWith("https://www.myinstants.com/instant")) {
                this.opener.document.getElementById("myinstantsurl").value = url;
                setSettings();
            }
        }
    }
}

function testSound() {
    console.log("testSound");
    var url = document.getElementById("myinstantsurl").value;
    var xhr = new XMLHttpRequest();
    console.log(url);
    xhr.open('GET', url, true);
    xhr.responseType = "document";
    xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
            if (xhr.status === 200) {
                console.log("ur");
                var audiourl = xhr.responseXML.querySelector("meta[property='og:audio']").getAttribute('content')
                console.log(audiourl);
                var audio = new Audio(audiourl);
                audio.play();
            }
        }
    }
    xhr.send();
}