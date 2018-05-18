"use strict"

var fs = require("fs")
var http = require("http")
var https = require("https")
var readline = require("readline")
var crc = require("crc-32")
var JSZip = require("jszip")
var progress = require("progress")
var noble = require("noble")
var { SecureDFU, writeCharacteristic } = require("../index")

var bluetoothDevices = []
var progressBar = null

function logError(error) {
  console.log(error.message || error)
  process.exit()
}

function getFileName() {
  return new Promise(resolve => {
    if (process.argv[2]) {
      return resolve(process.argv[2])
    }

    var rl = readline.createInterface(process.stdin, process.stdout)
    rl.question("Enter a URL or file path for the firmware package: ", answer => {
      rl.close()
      resolve(answer)
    })
    rl.write(
      "https://s3.eu-central-1.amazonaws.com/timeular-firmware-packages/firmwares/ZEI_320-801b_s130_app_dfu_package_v121_build_2.zip"
    )
  })
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    console.log("Downloading file...")
    var scheme = url.indexOf("https") === 0 ? https : http

    scheme
      .get(url, response => {
        var data = []
        response.on("data", chunk => {
          data.push(chunk)
        })
        response.on("end", () => {
          if (response.statusCode !== 200) return reject(response.statusMessage)

          var download = Buffer.concat(data)
          resolve(new Uint8Array(download).buffer)
        })
      })
      .on("error", error => {
        reject(error)
      })
  })
}

function loadFile(fileName) {
  return new Promise(resolve => {
    var file = fs.readFileSync(fileName)
    resolve(new Uint8Array(file).buffer)
  })
}

function handleDeviceFound(peripheral, selectFn) {
  var discovered = bluetoothDevices.some(device => {
    return device.id === peripheral.id
  })
  if (discovered) return

  if (bluetoothDevices.length === 0) {
    console.log("Select a device to update:")
  }

  bluetoothDevices.push({ id: peripheral.id, device: peripheral, select: () => selectFn(peripheral) })
  console.log(`${bluetoothDevices.length}: ${peripheral.advertisement.localName} (${peripheral.id})`)
}

function updateFirmware(dfu, dfuPackage, manifest, device, type, forceInit = false) {
  var init = null

  return dfuPackage
    .file(manifest.dat_file)
    .async("arraybuffer")
    .then(data => {
      init = data
      return dfuPackage.file(manifest.bin_file).async("arraybuffer")
    })
    .then(data => {
      console.log(`Using firmware: ${manifest.bin_file}`)
      progressBar = new progress(`Updating ${type} [:bar] :percent :etas`, {
        complete: "=",
        incomplete: " ",
        width: 20,
        total: data.byteLength,
      })

      return dfu.update(device, init, data, forceInit)
    })
}

function update(forceInit = false) {
  var dfu = null
  var dfuPackage = null
  var manifest = null

  getFileName()
    .then(fileName => {
      if (!fileName) throw new Error("No file name specified")
      if (fileName.indexOf("http") === 0) return downloadFile(fileName)
      return loadFile(fileName)
    })
    .then(file => {
      return JSZip.loadAsync(file)
    })
    .then(zipFile => {
      try {
        dfuPackage = zipFile
        return zipFile.file("manifest.json").async("string")
      } catch (e) {
        throw new Error("Unable to find manifest, is this a proper DFU dfuPackage?")
      }
    })
    .then(content => {
      manifest = JSON.parse(content).manifest
      dfu = new SecureDFU(crc.buf)
      dfu.on("progress", event => {
        if (progressBar && event.object === "firmware") {
          progressBar.update(event.currentBytes / event.totalBytes)
        }
      })
      dfu.on("log", event => {
        if (process.env.DEBUG) {
          console.log("[DFU]", event.message)
        }
      })
      dfu.on("error", err => {
        console.error("[ERROR]", err)
      })

      console.log("Scanning for DFU devices...")
      noble.startScanning([])
      return new Promise(resolve => {
        noble.on("discover", peripheral => handleDeviceFound(peripheral, resolve))
      })
    })
    .then(async device => {
      let count = 0
      while (true) {
        console.log("Connecting", count)
        await dfu.gattConnect(device)

        const service = await dfu.getDFUOnService(device)

        const characteristics = await dfu.getDFUCharacteristics(service)
        console.log(characteristics)

        const descriptors = await new Promise(resolve =>
          characteristics[0].discoverDescriptors((_, descriptors) => {
            resolve(descriptors)
          })
        )

        console.info(`[turnIntoDfuMode] found descriptors (${descriptors})`)
        const buffer = new Buffer(2)
        buffer.writeUInt8(1, 0)
        buffer.writeUInt8(0, 1)
        await descriptors[0].writeValue(buffer)
        console.info("[turnIntoDfuMode] wrote descriptor value")

        const buf2 = new Buffer([0x01])
        await writeCharacteristic(characteristics[0], buf2, false)

        await dfu.waitTimeout(5000)

        count++
      }
    })
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
    .then(() => {
      console.log("Update complete!")
      process.exit()
    })
    .catch(logError)
}

process.stdin.setEncoding("utf8")
process.stdin.on("readable", () => {
  var input = process.stdin.read()
  if (input === "\u0003") {
    process.exit()
  } else {
    var index = parseInt(input)
    if (index && index <= bluetoothDevices.length) {
      bluetoothDevices[index - 1].select()
    }
  }
})

update()
