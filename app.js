var websocket = null,
    debug = true, 
    piContext = 0,
    MActions = {},
    runningApps = [],
    contextArray = [],
    DestinationEnum = Object.freeze({ 'HARDWARE_AND_SOFTWARE': 0, 'HARDWARE_ONLY': 1, 'SOFTWARE_ONLY': 2 });

function connectElgatoStreamDeckSocket (
    inPort,
    inUUID,
    inMessageType,
    inApplicationInfo,
    inActionInfo
) {
    if (websocket) {
        websocket.close();
        websocket = null;
    };

    var appInfo = JSON.parse(inApplicationInfo);
    var isMac = appInfo.application.platform === 'mac';

    var getApplicationName = function (jsn) {
        if (jsn && jsn['payload'] && jsn.payload['application']) {
            return isMac ? jsn.payload.application.split('.').pop() : jsn.payload.application.split('.')[0];
        }
        return '';
    };

    websocket = new WebSocket('ws://localhost:' + inPort);

    websocket.onopen = function () {
        var json = {
            event: inMessageType,
            uuid: inUUID
        };

        websocket.send(JSON.stringify(json));
    };

    websocket.onclose = function (evt) {
        console.log('[STREAMDECK]***** WEBOCKET CLOSED **** reason:', evt);
    };

    websocket.onerror = function (evt) {
        console.warn('WEBOCKET ERROR', evt, evt.data);
    };

    websocket.onmessage = function (evt) {
        try {
            var jsonObj = JSON.parse(evt.data);
            var event = jsonObj['event'];
            
            // console.log("event:" , event);
            if (~['applicationDidLaunch', 'applicationDidTerminate'].indexOf(event)) {
                const app = capitalize(getApplicationName(jsonObj));
                const img = `images/${jsonObj.payload.application}.png`;
                const arrImages = event === 'applicationDidTerminate' ? [img, 'images/terminated.png'] : img;
                contextArray.forEach(a => {
                    loadAndSetImage(a, arrImages);
                });

                if (event === 'applicationDidLaunch') {
                    if (!runningApps.includes(app)) { runningApps.push(app); };
                } else if (event === 'applicationDidTerminate') {
                    runningApps = runningApps.filter(item => item !== app);
                }

                if (piContext && piContext !== 0) { // there's a property inspector
                    sendToPropertyInspector(piContext, { runningApps });
                }
            } else {
              
                /** dispatch message */
                let bEvt;
                if (jsonObj['event'] && jsonObj['event'] === 'willAppear') {
                    bEvt = jsonObj['event'];
                } else {
                    bEvt = !jsonObj.hasOwnProperty('action') ? jsonObj.event : jsonObj.event + jsonObj['context'];
                }

                // console.log("action:" , action);
                // console.log("bEvt:", bEvt);
                if (action.hasOwnProperty(bEvt)) {
                    action[bEvt](jsonObj);
                }
            }
        } catch (error) {
            console.trace('Could not parse incoming message', error, evt.data);
        }
    };
}

/**
 * We use a contextArray to push our context. You can use a cache to keep some
 * data private to the plugin or to update a key regularily without waiting
 * for an event.
 * This will also work with multi-actions stored in different contexts
*/

var action = {

    willAppear: function (jsn) {
        console.log('**** action.WILLAPPEAR', jsn.context);
        console.log(jsn);
        if (!contextArray.includes(jsn.context)) {
            contextArray.push(jsn.context);
        }
        
        if(jsn.payload.settings.myinstantsurl)
        {
            loadAndSetImageFromUrl(jsn.context, jsn.payload.settings.myinstantsurl);
        }

        action['keyUp' + jsn.context] = function (jsn) {
            console.log('**** action.KEYUP', jsn.context);
            console.log(jsn);
            var settings = jsn.payload.settings;
            if(settings != null && settings.hasOwnProperty('myinstantsaudiourl')){
                var audio = new Audio(jsn.payload.settings.myinstantsaudiourl);
                audio.play();
            }
        };

        action['sendToPlugin' + jsn.context] = function (jsn) {
            console.log('**** action.SENDTOPLUGIN', jsn.context, jsn);
            if (jsn.hasOwnProperty('payload')) {
                const pl = jsn.payload;

                if (pl.hasOwnProperty('property_inspector')) {
                    const pi = pl.property_inspector;
                    console.log('%c%s', 'font-style: bold; color: white; background: blue; font-size: 15px;', `PI-event for ${jsn.context}:${pi}`);
                    switch (pl.property_inspector) {
                    case 'propertyInspectorWillDisappear':
                        loadAndSetImage(jsn.context, `images/piterminated.png`);
                        setTimeout(() => {
                            loadAndSetImage(jsn.context, `images/default.png`);
                        }, 500);
                        setContext(0); // set a flag, that our PI was removed
                        break;
                    case 'propertyInspectorConnected':
                        setContext(jsn.context);
                        sendToPropertyInspector(jsn.context, { runningApps });
                        break;
                    };
                } else {
                    if (pl.hasOwnProperty('sdpi_collection')) {
                        console.log('%c%s', 'color: white; background: red; font-size: 12px;', `PI SENDTOPLUGIN sdpi_collection for ${jsn.context}`);
                        console.log(pl.sdpi_collection['key']);
                        console.log(pl.sdpi_collection['value']);

                        if (pl.sdpi_collection['key'] === 'image') {
                            setImage(jsn.context, pl.sdpi_collection['value']);
                        } else {
                            setTitle(jsn.context, pl.sdpi_collection['value']);
                        }
                    } else if (pl.hasOwnProperty('DOM')) {

                    } else {
                        console.log('%c%s', 'color: white; background: green; font-size: 12px;', `PI SENDTOPLUGIN for ${jsn.context}`);
                    }
                }
            }
        };

        action['willDisappear' + jsn.context] = function (jsn) {
            console.log('**** action.WILLDISAPPEAR', jsn.context, contextArray);
            contextArray = contextArray.filter(item => item !== jsn.context);
            console.log(jsn);
            console.log(contextArray);
        };

    }
};

/** STREAM DECK COMMUNICATION */

function sendToPropertyInspector (context, jsonData, xx) {
    var json = {
        'event': 'sendToPropertyInspector',
        'context': context,
        'payload': jsonData
    };
    console.log('-----');
    console.log('sending to Property Inspector', xx, context, piContext, json, JSON.stringify(json));
    websocket.send(JSON.stringify(json));
};

function setTitle (context, newTitle) {
    // var apps = runningApps.join('\n');

    var json = {
        'event': 'setTitle',
        'context': context,
        'payload': {
            // 'title': `${newTitle}\n${apps}`,
            'title': `${newTitle}`,
            'target': DestinationEnum.HARDWARE_AND_SOFTWARE
        }
    };

    websocket.send(JSON.stringify(json));
};

function setImage (context, imgData) {

    var json = {
        'event': 'setImage',
        'context': context,
        'payload': {
            'image': imgData,
            'target': DestinationEnum.HARDWARE_AND_SOFTWARE
        }
    };

    websocket.send(JSON.stringify(json));
};

function loadAndSetImage (context, imageNameOrArr) {
    loadImage(imageNameOrArr, function (data) {
        var json = {
            'event': 'setImage',
            'context': context,
            'payload': {
                'image': data,
                'target': DestinationEnum.HARDWARE_AND_SOFTWARE
            }
        };
        websocket.send(JSON.stringify(json));
    });
};

function loadAndSetImageFromUrl (context, imageNameOrArr) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', imageNameOrArr, true);
    xhr.responseType = "document";
    xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
            if (xhr.status === 200) {
                console.log("test");
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
                loadAndSetImage(context,imgUrl);
                var soundTitle = xhr.responseXML.getElementById("content").getElementsByTagName('h1')[0].innerText;
                setTitle(context, soundTitle);
            }
        }
    };
    xhr.send();
};

/** UTILS */

function capitalize (str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

function equalArray (a, b) {
    if (a.length != b.length) {
        return false;
    }
    return a.filter(function (i) {
        return !b.includes(i);
    }).length === 0;
}

function setContext (ctx) {
    console.log('%c%s', 'color: white; background: blue; font-size: 12px;', 'piContext', ctx, piContext);
    piContext = ctx;
    console.log('new context: ', piContext);
}

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

                callback(canvas.toDataURL('image/png'));
                // or to get raw image data
                // callback && callback(canvas.toDataURL('image/png').replace(/^data:image\/(png|jpg);base64,/, ''));
            }
        };

        imgCount--;
        image.src = url;
    }
};
