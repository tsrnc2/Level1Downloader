const puppeteer = require("puppeteer")
const fs = require("fs")
const path = require("path")
const https = require("https")

const sleep = (milliseconds) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function formatDate(inputDate) {
    // Create a Date object from the input string
    const date = new Date(inputDate)

    // Check if the Date object is valid
    if (isNaN(date)) {
        return "Invalid Date"
    }

    // Get day, month, and year from the Date object
    const day = date.getDate().toString().padStart(2, "0")
    const month = (date.getMonth() + 1).toString().padStart(2, "0") // Note: Months are zero-indexed, so we add 1.
    const year = date.getFullYear()

    // Format the date as 'DD_MM_YYYY'
    const formattedDate = `${day}_${month}_${year}`

    return formattedDate
}

;(async () => {
    // Provide the path to your Google Chrome executable
    // const chromeExecutablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    // const chromeUserDataDir = "C:\\Users\\rahat\\AppData\\Local\\Google\\Chrome\\User Data"

    const browser = await puppeteer.launch({
        headless: 'new', // You can set this to true if you want to run in headless mode
        // executablePath: chromeExecutablePath,
        // userDataDir: chromeUserDataDir,
        userDataDir: "tmp",
        defaultViewport: false,
        ignoreDefaultArgs: ["--enable-automation"],
    })

    const page = await browser.newPage()
    try {
        console.log("Logging")
        await page.goto("https://www.floatplane.com/login")
        const credential = JSON.parse(fs.readFileSync("credential.json", "utf8"))
        await sleep(2)
        await page.type("input[placeholder='Username or email']", credential.username)
        await page.type("input[placeholder='Password']", credential.password)
        await page.click(".btn-medium.btn-primary-outlined.landing-form-button")
        await page.waitForNavigation()
        // await sleep(0)
    } catch (e) {
        // doing nothing
    }

    try {
        console.log("visiting: ", "https://www.floatplane.com/channel/level1techs/home")
        await page.goto("https://www.floatplane.com/channel/level1techs/home")

        await page.waitForSelector(".PostTileTitle", { visible: true })

        const searchedString = "The Level1 Show"
        // const searchedString = "Computex 2023"       // just for the scrolling test

        let titles = await page.$$eval(".PostTileTitle", (elements) => elements.map((element) => element.textContent))
        let startsWithSearchedString = titles.some((str) => str.startsWith(searchedString))
        while (!startsWithSearchedString) {
            await page.evaluate(() => {
                window.scrollBy(0, 1000)
            })
            await sleep(3000)
            titles = await page.$$eval(".PostTileTitle", (elements) => elements.map((element) => element.textContent))
            startsWithSearchedString = titles.some((str) => str.startsWith(searchedString))
        }

        console.log("we have found ", searchedString)

        await page.waitForSelector(".PostTileInfoHorizontalWrapper", {visible: true})
        let videos = await page.$$eval(".PostTileInfoHorizontalWrapper", (elements) =>
            elements.map((element, index) => {
                return {
                    // link: element.querySelector("a").getAttribute("href"),
                    link: element.querySelector("a").getAttribute('href'),
                    title: element.querySelector(".PostTileTitle").textContent,
                }
            })
        )
        // console.log(videos)

        for (const video of videos) {
            if (video.title.startsWith(searchedString)) {
                await page.goto(`https://www.floatplane.com`+video.link)
                break
            }
        }

        await page.waitForSelector(".post-date", { visible: true })
        const upload_date = await page.$eval(".post-date", (element) => element.textContent)
        // console.log(upload_date)
        // console.log(formatDate(upload_date))
        const fileNameWithoutExtension = formatDate(upload_date)

        // checking file existence

        const directoryPath = "download"
        if (!fs.existsSync(directoryPath)) {
            fs.mkdirSync(directoryPath, { recursive: true })
        }

        const directoryContents = fs.readdirSync(directoryPath)
        const matchingFile = directoryContents.find((file) => {
            const fileWithoutExtension = path.parse(file).name
            return fileWithoutExtension === fileNameWithoutExtension
        })

        if (matchingFile) {
            console.log(`File "${fileNameWithoutExtension}.mp4" exists in the directory.`)
        } else {
            console.log(`File "${fileNameWithoutExtension}.mp4" does not exist in the directory.`)

            let downloadInstruction
            page.on("response", async (res) => {
                if (res.url().includes("https://www.floatplane.com/api/v2/cdn/delivery?type=download")) {
                    downloadInstruction = await res.json()
                }
            })
            await sleep(1000)
            await page.click(".PostDownloadButton div i")
            await sleep(2000)

            // console.log(downloadInstruction)
            function constructUriFromJson(jsonData) {
                // Extract the values from the "1080-avc1" quality level
                const qualityLevelParams = jsonData.resource.data.qualityLevelParams
                const qualityLevel = qualityLevelParams["1080-avc1"]
                const qualityLevel1 = qualityLevel["1"]
                const qualityLevel2 = qualityLevel["2"]

                // Construct the result string
                const cdn = jsonData.cdn
                const uri = jsonData.resource.uri.replace("{qualityLevelParams.1}", qualityLevel1).replace("{qualityLevelParams.2}", qualityLevel2)

                // return cdn + uri;
                return cdn + uri + `&attachment=true&filename=${fileNameWithoutExtension}.mp4`
            }
            const downloadResource = constructUriFromJson(downloadInstruction)
            console.log(downloadResource)

            function downloadFile(url, filePath) {
                return new Promise((resolve, reject) => {
                    const fileStream = fs.createWriteStream(filePath)
                    let downloadedBytes = 0
                    let totalBytes = 0

                    https
                        .get(url, (response) => {
                            totalBytes = parseInt(response.headers["content-length"], 10)

                            response.on("data", (chunk) => {
                                downloadedBytes += chunk.length
                                fileStream.write(chunk)
                                const percentComplete = ((downloadedBytes / totalBytes) * 100).toFixed(2)
                                process.stdout.clearLine()
                                process.stdout.cursorTo(0)
                                process.stdout.write(`Downloading... ${percentComplete}%`)
                            })

                            response.on("end", () => {
                                fileStream.end()
                                process.stdout.write("\n")
                                resolve()
                            })

                            response.on("error", (err) => {
                                fs.unlinkSync(filePath) // Delete the file if an error occurs
                                reject(err)
                            })
                        })
                        .on("error", (err) => {
                            fs.unlinkSync(filePath) // Delete the file if an error occurs
                            reject(err)
                        })
                })
            }

            downloadFile(downloadResource, `${directoryPath}/${fileNameWithoutExtension}.mp4`)
                .then(() => {
                    console.log("File download completed.")
                })
                .catch((error) => {
                    console.error("Error downloading file:", error)
                })
        }
    } catch (e) {
        console.log(e)
    }

    await browser.close()
})()
