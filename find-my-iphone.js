"use strict";

var soef = require('soef');
var ICloud =  require(__dirname + '/lib/icloud');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

soef._extendObject_ = true;
var refreshTimer = soef.Timer();
var iCloud;
var locationToFixedVal = 4;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var adapter = soef.Adapter (
    main,
    onStateChange,
    onUnload,
    { name: 'find-my-iphone' }
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function onUnload(cb) {
    refefreshTimer.clear();
    if (iCloud) iCloud.logout();
    for (var i in devices) {
        if (devices[i].refreshTimer) {
            clearTimeout(devices[i].refreshTimer);
            delete devices[i].refreshTimer
        }
    }
    iCloud = null;
}

function onStateChange(id, state) {
    var ar = id.split('.');
    //var dcs = adapter.idToDCS(id);
    var deviceName = ar[2], stateName = ar[3];
    devices.invalidate(id);
    var device = devices.get(deviceName);
    switch (stateName || 'root') {
        case 'lost':
            var options, ar;
            ar = state.val.toString().split(';');
            options = { text: ar.shift() };
            if (ar.length) options.ownerNbr = ar.shift();
            if (ar.length) options.passcode = ar.shift();
            iCloud.lostDevice (device.native.id, options, function(err, data) {
                 setTimeout(manUpdateDevice, 2000);
            });
            break;
        case 'alert':
            if (device && device.native && device.native.id) {
                var msg = typeof state.val == 'string' && state.val != "" ? state.val : 'ioBroker Find my iPhone Alert';
                iCloud.alertDevice(device.native.id, msg, function (err) {
                });
            }
            break;
        case 'refresh':
            if (device && device.native && device.native.id) {
                updateWithTimer(device, state.val);
            }
            break;
        case 'lostMode':
            if (!state.val) iCloud.stopLostMode(device.native.id, function() {
                setTimeout(manUpdateDevice, 2000);
            });
            break;
        case 'root':
            switch(deviceName) {
                case 'refresh':
                    devices.setState(id, false);
                    manUpdateDevice();
                    break;
            }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function createOurState (device, cb) {
    var dev = new devices.CDevice(0, '');
    var native = { id: device.id };
    if (device.lostDevice) native.lostDevice = device.lostDevice;
    dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: native });
    dev.createNew('batteryLevel', { val: (device.batteryLevel * 100) >> 0, common: { unit: '%'}});
    dev.createNew('alert', 'ioBroker Find my iPhone Alert');
    dev.createNew('lost', { val: '', common: { name: 'Lost Mode', desc: 'Parameter: usertext[;phone number to call[;passcode]'} } );
    dev.createNew('refresh', { val: false, common: { name: 'Refresh this device with shouldLocate=true' } });
    dev.createNew('isLocating', { val: !!device.isLocating, common: { write: false }} );
    updateOurState(device, dev, cb);
}

function updateOurState(device, dev, cb) {
    if (typeof dev !== 'object') {
        cb = dev;
        dev = new devices.CDevice(0, '');
        var native = { id: device.id };
        if (device.lostDevice) native.lostDevice = device.lostDevice;
        dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: native });
    }
    dev.set('batteryLevel', { val: (device.batteryLevel * 100) >> 0, common: { unit: '%'}});
    dev.set('lostModeCapable', device.lostModeCapable);
    dev.set('isLocating', !!device.isLocating);
    if (device.location) {
        dev.set('positionType', device.location.positionType);
        dev.set('timeStamp', device.location.timeStamp);
        var tsStr = adapter.formatDate(new Date(device.location.timeStamp), 'YYYY-MM-DD hh:mm:ss');
        dev.set('time', tsStr);
        if (device.name === 'iPhone-7-FL') {
            var xyz = 1;
        }
        dev.set('lostMode', (!!device.lostDevice && (~~device.lostDevice.statusCode) >= 2204));
        
        // var changed = dev.set('latitude', device.location.latitude);
        // changed |= dev.set('longitude', device.location.longitude);
        var changed = dev.set('latitude', device.location.latitude.toFixed(locationToFixedVal));
        changed |= dev.set('longitude', device.location.longitude.toFixed(locationToFixedVal));
        if (changed) {
            dev.set('map-url', 'http://maps.google.com/maps?z=15&t=m&q=loc:' + device.location.latitude + '+' + device.location.longitude);
            iCloud.getDistance(device, function (err, result) {
                if (!err && result && result.distance && result.duration) {
                    dev.set('distance', result.distance.text);
                    dev.set('duration', result.duration.text);
                }
                iCloud.getAddressOfLocation(device, function (err, location) {
                    if (!err && result) {
                        dev.set('location', location);
                    }
                    cb && setTimeout(cb, 10);
                });
            });
            return;
        }
    }
    cb && setTimeout(cb, 10);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function manUpdateDevice(deviceId, cb) {
    if (iCloud.authenticated === undefined) iCloud.authenticated = false;
    updateDevice(deviceId, cb);
}

function updateWithTimer(device, val, cb) {
    var bo, cnt, time, timeout = 30000;
    //devices.setState({ device: device.common.name, state: 'isLocating', val: true });
    devices.setState({ device: device.common.name }, 'isLocating', true );
    val = valtype (val);
    if ((bo = typeof val === 'boolean')) {
        cnt = 4;
        timeout = 15000
    } else {
        if ((time = ~~val) <= 0) return;  // time to refresh in minutes
        cnt = time * 2;
    }
    if (device.refreshTimer !== undefined) clearTimeout (device.refreshTimer);
    if (iCloud.authenticated === undefined) iCloud.authenticated = false;

    var req = { device: device.native.id, shouldLocate: true };
    var doIt = function () {
        manUpdateDevice (req, function (appleDevice) {
            if (cnt-- <= 0 || (bo && appleDevice.isLocating === false)) {
                delete device.refreshTimer;
                devices.setState({ device: device.common.name, state: 'refresh', val: false });
                return;
            }
            req.shouldLocate = !bo;
            device.refreshTimer = setTimeout (doIt, timeout);
        });
    };
    doIt ();
}


// function xsetOurStates(appleDevices, cb) {
//     var i = 0;
//
//     function doIt() {
//         if (i >= appleDevices.length) {
//             devices.update(function() {
//                 dev = null;
//                 cb && cb();
//             });
//             return;
//         }
//         var device = appleDevices[i++];
//         var dev = new devices.CDevice(0, '');
//         //dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: {id: device.id}});
//         //dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: {id: device.id, lostDevice: device.lostDevice ? device.lostDevice : {} } });
//         var native = { id: device.id };
//         if (device.lostDevice) native.lostDevice = device.lostDevice;
//         dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: native });
//         dev.set('batteryLevel', { val: (device.batteryLevel * 100) >> 0, common: { unit: '%'}});
//         dev.set('lostModeCapable', device.lostModeCapable);
//         // dev.set('alert', 'ioBroker Find my iPhone Alert');
//         // dev.set('lost', { val: '', common: { name: 'Lost Mode', desc: 'Parameter: usertext[;phone number to call[;passcode]'} } );
//         dev.createNew('alert', 'ioBroker Find my iPhone Alert');
//         dev.createNew('lost', { val: '', common: { name: 'Lost Mode', desc: 'Parameter: usertext[;phone number to call[;passcode]'} } );
//         dev.createNew('refresh', false);
//         dev.set('isLocating', { val: !!device.isLocating, common: { write: false }} );
//         if (device.location) {
//             dev.set('positionType', device.location.positionType);
//             dev.set('timeStamp', device.location.timeStamp);
//             var tsStr = adapter.formatDate(new Date(device.location.timeStamp), 'YYYY-MM-DD hh:mm:ss');
//             dev.set('time', tsStr);
//             if (device.name === 'iPhone-7-FL') {
//                 var xyz = 1;
//             }
//             dev.set('lostMode', (!!device.lostDevice && (~~device.lostDevice.statusCode) >= 2204));
//
//             var changed = dev.set('latitude', device.location.latitude);
//             changed |= dev.set('longitude', device.location.longitude);
//             if (changed) {
//                 dev.set('map-url', 'http://maps.google.com/maps?z=15&t=m&q=loc:' + device.location.latitude + '+' + device.location.longitude);
//                 iCloud.getDistance(device, function (err, result) {
//                     if (!err && result && result.distance && result.duration) {
//                         dev.set('distance', result.distance.text);
//                         dev.set('duration', result.duration.text);
//                     }
//                     iCloud.getAddressOfLocation(device, function (err, location) {
//                         if (!err && result) {
//                             dev.set('location', location);
//                         }
//                         setTimeout(doIt, 10);
//                     });
//                 });
//                 return;
//             }
//         }
//         setTimeout(doIt, 10);
//     }
//     doIt();
// }
//
// function xupdateDevice (deviceId, cb) {
//     if (typeof deviceId === 'function') {
//         cb = deviceId;
//         deviceId = 'all';
//     }
//
//     function call (appleDevices) {
//         setOurStates (appleDevices, function () {
//             if (deviceId === 'all' && adapter.config.refreshInterval) refreshTimer.set (updateDevice, adapter.config.refreshInterval);
//             cb && cb ();
//         });
//     }
//
//     refreshTimer.clear ();
//     switch (iCloud.authenticated) {
//         case undefined:
//             break;
//         case false:
//             iCloud.authenticated = undefined; // only one retry
//             iCloud.login (function (response) {
//                 if (iCloud.authenticated) iCloud.initClient (call);
//             });
//             return;
//         case true:
//             iCloud.refreshClient (deviceId, call);
//     }
// }
//
// function xgetAppleDevices (deviceId, callback) {
//     if (typeof deviceId === 'function') {
//         cb = deviceId;
//         deviceId = 'all';
//     }
//
//     //refreshTimer.clear();
//     switch (iCloud.authenticated) {
//         case undefined:
//             break;
//         case false:
//             iCloud.authenticated = undefined; // only one retry
//             iCloud.login (function (response) {
//                 if (iCloud.authenticated) iCloud.initClient (callback);
//             });
//             return;
//         case true:
//             iCloud.refreshClient (deviceId, callback);
//     }
// }
//
// function xforEachAppleDevice (deviceId, setCallback, readyCallback) {
//     getAppleDevices (deviceId, function (appleDevices) {
//         forEachArrayCallback (appleDevices, devices.update.bind (devices, readyCallback), setCallback);
//     })
// }
//
// function xforEachAppleDevice (deviceId, setCallback, readyCallback) {
//     getAppleDevices (deviceId, function (appleDevices) {
//         forEachArrayCallback (appleDevices,
//             function () {
//                 devices.update (function () {
//                     //dev = null;
//                     readyCallback && readyCallback ();
//                 });
//             },
//             setCallback
//         );
//     })
// }
//
//

// function forEachAppleDevice(deviceId, setCallback, readyCallback) {
//     if (typeof deviceId === 'function') {
//         cb = deviceId;
//         deviceId = 'all';
//     }
//     iCloud.refreshClientEx (deviceId, function(appleDevices) {
//         //forEachArrayCallback (appleDevices, devices.update.bind(devices, readyCallback), setCallback);
//         //return;
//         forEachArrayCallback (appleDevices,
//             function () {
//                 devices.update (function () {
//                     //dev = null;
//                     readyCallback && readyCallback ();
//                 });
//             },
//             setCallback
//         );
//     })
// }
//

function forEachAppleDevice(deviceId, setCallback, readyCallback) {
    iCloud.forEachDevice(deviceId, setCallback, devices.update.bind(devices, readyCallback));
    // iCloud.forEachDevice(deviceId, setCallback, function() {
    //     devices.update(readyCallback);
    // });
}

function updateDevice(deviceId, callback) {
    var func = updateOurState;
    if (deviceId && deviceId !== 'all') {
        func = function(device, doIt) {
            if (device.id !== deviceId && device.id !== deviceId.device) return doIt();
            updateOurState(device, callback.bind(1, device));
        }
    }
    forEachAppleDevice(deviceId, func, callback);
}

function createDevices (callback) {
    // devices.setdcState = function (d, c, s, val, ack) {
    //     d = normalizedName(d);
    //     if (c !== undefined) c = normalizedName(c);
    //     var id = dcs(d,c,s);
    //     this.setState(id, val, ack);
    // };
    // devices.setdState = function (d, s, val, ack) {
    //     this.setdcState(d, undefined, s, val, ack);
    // };
    // devices.orig_setState = devices.setState;
    
    // devices.setEx = function (id, val, ack) {
    //     this.setState(soef.ns.no(id), val, ack);
    // };

    devices.root.createNew('refresh', { val: false, common: { name: 'Refresh all devices (refreshClient with shouldLocate=false)' } });
    forEachAppleDevice ('all', createOurState, function () {
        callback && callback ();
    });
}

function decrypt(str) {
    if (!str) str = "";
    try {
        var key = 159;
        var pos = 0;
        var ostr = '';
        while (pos < str.length) {
            ostr = ostr + String.fromCharCode(key ^ str.charCodeAt(pos));
            pos += 1;
        }
        return ostr;
    } catch (ex) {
        return '';
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function normalizeConfig(config) {
    config.username = decrypt(config.username);
    config.password = decrypt(config.password);
    if (config.locationToFixedVal !== undefined) locationToFixedVal = config.locationToFixedVal;
    //config.refreshInterval = 20000;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function main() {
    normalizeConfig(adapter.config);
    
    iCloud = new ICloud(adapter.config.username, adapter.config.password);
    if (adapter.config.key2Step) iCloud.password += adapter.config.key2Step;
    
    adapter.getForeignObject('system.adapter.javascript.0', function(err, obj) {
        iCloud.setOwnLocation( !err && obj ? obj.native : null, createDevices);
    });
    adapter.subscribeStates('*');
    adapter.subscribeObjects('*');
}

