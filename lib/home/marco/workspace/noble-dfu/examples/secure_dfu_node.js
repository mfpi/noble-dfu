"use strict";

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

var fs = require("fs");
var http = require("http");
var https = require("https");
var readline = require("readline");
var crc = require("crc-32");
var JSZip = require("jszip");
var progress = require("progress");
var noble = require("noble");

var _require = require("../index"),
    SecureDFU = _require.SecureDFU,
    writeCharacteristic = _require.writeCharacteristic;

var bluetoothDevices = [];
var progressBar = null;

function logError(error) {
  console.log(error.message || error);
  process.exit();
}

function getFileName() {
  return new Promise(function (resolve) {
    if (process.argv[2]) {
      return resolve(process.argv[2]);
    }

    var rl = readline.createInterface(process.stdin, process.stdout);
    rl.question("Enter a URL or file path for the firmware package: ", function (answer) {
      rl.close();
      resolve(answer);
    });
    rl.write("https://s3.eu-central-1.amazonaws.com/timeular-firmware-packages/firmwares/ZEI_320-801b_s130_app_dfu_package_v121_build_2.zip");
  });
}

function downloadFile(url) {
  return new Promise(function (resolve, reject) {
    console.log("Downloading file...");
    var scheme = url.indexOf("https") === 0 ? https : http;

    scheme.get(url, function (response) {
      var data = [];
      response.on("data", function (chunk) {
        data.push(chunk);
      });
      response.on("end", function () {
        if (response.statusCode !== 200) return reject(response.statusMessage);

        var download = Buffer.concat(data);
        resolve(new Uint8Array(download).buffer);
      });
    }).on("error", function (error) {
      reject(error);
    });
  });
}

function loadFile(fileName) {
  return new Promise(function (resolve) {
    var file = fs.readFileSync(fileName);
    resolve(new Uint8Array(file).buffer);
  });
}

function handleDeviceFound(peripheral, selectFn) {
  var discovered = bluetoothDevices.some(function (device) {
    return device.id === peripheral.id;
  });
  if (discovered) return;

  if (bluetoothDevices.length === 0) {
    console.log("Select a device to update:");
  }

  bluetoothDevices.push({ id: peripheral.id, device: peripheral, select: function select() {
      return selectFn(peripheral);
    } });
  console.log(bluetoothDevices.length + ": " + peripheral.advertisement.localName + " (" + peripheral.id + ")");
}

function updateFirmware(dfu, dfuPackage, manifest, device, type) {
  var forceInit = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : false;

  var init = null;

  return dfuPackage.file(manifest.dat_file).async("arraybuffer").then(function (data) {
    init = data;
    return dfuPackage.file(manifest.bin_file).async("arraybuffer");
  }).then(function (data) {
    console.log("Using firmware: " + manifest.bin_file);
    progressBar = new progress("Updating " + type + " [:bar] :percent :etas", {
      complete: "=",
      incomplete: " ",
      width: 20,
      total: data.byteLength
    });

    return dfu.update(device, init, data, forceInit);
  });
}

function update() {
  var _this = this;

  var forceInit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

  var dfu = null;
  var dfuPackage = null;
  var manifest = null;

  getFileName().then(function (fileName) {
    if (!fileName) throw new Error("No file name specified");
    if (fileName.indexOf("http") === 0) return downloadFile(fileName);
    return loadFile(fileName);
  }).then(function (file) {
    return JSZip.loadAsync(file);
  }).then(function (zipFile) {
    try {
      dfuPackage = zipFile;
      return zipFile.file("manifest.json").async("string");
    } catch (e) {
      throw new Error("Unable to find manifest, is this a proper DFU dfuPackage?");
    }
  }).then(function (content) {
    manifest = JSON.parse(content).manifest;
    dfu = new SecureDFU(crc.buf);
    dfu.on("progress", function (event) {
      if (progressBar && event.object === "firmware") {
        progressBar.update(event.currentBytes / event.totalBytes);
      }
    });
    dfu.on("log", function (event) {
      if (process.env.DEBUG) {
        console.log("[DFU]", event.message);
      }
    });
    dfu.on("error", function (err) {
      console.error("[ERROR]", err);
    });

    console.log("Scanning for DFU devices...");
    noble.startScanning([]);
    return new Promise(function (resolve) {
      noble.on("discover", function (peripheral) {
        return handleDeviceFound(peripheral, resolve);
      });
    });
  }).then(function () {
    var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(device) {
      var count, _loop;

      return regeneratorRuntime.wrap(function _callee$(_context2) {
        while (1) {
          switch (_context2.prev = _context2.next) {
            case 0:
              count = 0;
              _loop = /*#__PURE__*/regeneratorRuntime.mark(function _loop() {
                var service, characteristics, descriptors, buffer, buf2;
                return regeneratorRuntime.wrap(function _loop$(_context) {
                  while (1) {
                    switch (_context.prev = _context.next) {
                      case 0:
                        console.log('Connecting', count);
                        _context.next = 3;
                        return dfu.gattConnect(device);

                      case 3:
                        _context.next = 5;
                        return dfu.getDFUOnService(device);

                      case 5:
                        service = _context.sent;
                        _context.next = 8;
                        return dfu.getDFUCharacteristics(service);

                      case 8:
                        characteristics = _context.sent;

                        console.log(characteristics);

                        _context.next = 12;
                        return new Promise(function (resolve) {
                          return characteristics[0].discoverDescriptors(function (_, descriptors) {
                            resolve(descriptors);
                          });
                        });

                      case 12:
                        descriptors = _context.sent;


                        console.info("[turnIntoDfuMode] found descriptors (" + descriptors + ")");
                        buffer = new Buffer(2);

                        buffer.writeUInt8(1, 0);
                        buffer.writeUInt8(0, 1);
                        _context.next = 19;
                        return descriptors[0].writeValue(buffer);

                      case 19:
                        console.info('[turnIntoDfuMode] wrote descriptor value');

                        buf2 = new Buffer([0x01]);
                        _context.next = 23;
                        return writeCharacteristic(characteristics[0], buf2, false);

                      case 23:
                        _context.next = 25;
                        return dfu.waitTimeout(5000);

                      case 25:

                        count++;

                      case 26:
                      case "end":
                        return _context.stop();
                    }
                  }
                }, _loop, _this);
              });

            case 2:
              if (!true) {
                _context2.next = 6;
                break;
              }

              return _context2.delegateYield(_loop(), "t0", 4);

            case 4:
              _context2.next = 2;
              break;

            case 6:
            case "end":
              return _context2.stop();
          }
        }
      }, _callee, _this);
    }));

    return function (_x3) {
      return _ref.apply(this, arguments);
    };
  }())
  // .then(device => {
  //   console.log(`Updating ${device.id}...`)
  //   for (var type of ["softdevice", "bootloader", "softdevice_bootloader"]) {
  //     if (manifest[type]) {
  //       return updateFirmware(dfu, dfuPackage, manifest[type], device, type).then(() => device)
  //     }
  //   }
  //   return device
  // })
  // .then(device => {
  //   if (manifest.application) {
  //     return updateFirmware(dfu, dfuPackage, manifest.application, device, "application", forceInit)
  //   }
  // })
  .then(function () {
    console.log("Update complete!");
    process.exit();
  }).catch(logError);
}

process.stdin.setEncoding("utf8");
process.stdin.on("readable", function () {
  var input = process.stdin.read();
  if (input === "\x03") {
    process.exit();
  } else {
    var index = parseInt(input);
    if (index && index <= bluetoothDevices.length) {
      bluetoothDevices[index - 1].select();
    }
  }
});

update();