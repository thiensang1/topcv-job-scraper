// --- ĐIỆP VIÊN VIECLAM24H - PHIÊN BẢN "CHIẾN DỊCH BẢN ĐỒ" ---
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

// --- CẤU HÌNH ---
const SITEMAP_INDEX_URL = "https://vieclam24h.vn/file/sitemap/sitemap-index.xml";
const CHROME_PATH = process.env.CHROME_PATH;
const PROXY_API_KEY = process.env.PROXY_API_KEY;
const PROXY_API_ENDPOINT = process.env.PROXY_API_ENDPOINT;

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function getProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("-> Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.error("-> [V24h-Điệp viên] Đang yêu cầu một danh tính proxy MỚI từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 20000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`-> [V24h-Điệp viên] Đã nhận proxy mới thành công: ${host}:${port}`);
            return { host, port };
        }
        throw new Error(`Phản hồi API proxy không như mong đợi.`);
    } catch (error) {
        console.error(`-> [V24h-Điệp viên] Lỗi khi yêu cầu proxy mới: ${error.message}`);
        return null;
    }
}

// --- GIAI ĐOẠN 1 & 2: ĐỌC SITEMAP ĐỂ LẤY URLS ---
async function getAllJobUrls() {
    console.error("--- Giai đoạn 1: Đọc 'bản đồ' sitemap ---");
    const jobUrls = new Set();
    try {
        const indexResponse = await axios.get(SITEMAP_INDEX_URL);
        const $ = cheerio.load(indexResponse.data, { xmlMode: true });
        const sitemapUrls = [];
        $('sitemap loc').each((i, el) => {
            const url = $(el).text();
            // Chỉ lấy các sitemap chứa tin tuyển dụng
            if (url.includes('sitemap-jobs')) {
                sitemapUrls.push(url);
            }
        });

        console.error(`--- Giai đoạn 2: Tìm thấy ${sitemapUrls.length} sitemap con. Đang thu thập 'tọa độ' (URL)... ---`);
        for (const sitemapUrl of sitemapUrls) {
            try {
                const sitemapResponse = await axios.get(sitemapUrl);
                const $$ = cheerio.load(sitemapResponse.data, { xmlMode: true });
                $$('url loc').each((i, el) => {
                    jobUrls.add($$(el).text());
                });
            } catch (error) {
                console.error(` -> Lỗi khi đọc sitemap con ${sitemapUrl}: ${error.message}`);
            }
        }
        console.error(`-> Đã thu thập được ${jobUrls.size} URL việc làm duy nhất.`);
        return Array.from(jobUrls);
    } catch (error) {
        console.error("Lỗi nghiêm trọng khi đọc sitemap index:", error.message);
        return [];
    }
}

// --- GIAI ĐOẠN 3: TRIỂN KHAI ĐIỆP VIÊN ---
async function scrapeJobDetails(url, browser) {
    let page;
    try {
        page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const title = await page.$eval('h1.job-title', el => el.innerText.trim()).catch(() => null);
        const company = await page.$eval('a.company-name', el => el.innerText.trim()).catch(() => null);
        const salary = await page.$eval('span[data-id="Salary"]', el => el.innerText.trim()).catch(() => "Thỏa thuận");
        
        // Nơi làm việc có thể nằm ở nhiều chỗ, thử nhiều selector
        let location = await page.$eval('div.list-work-place-item span.text-dark-gray', el => el.innerText.trim()).catch(() => null);
        if (!location) {
            location = await page.$eval('span[data-id="Location"]', el => el.innerText.trim()).catch(() => "Không xác định");
        }

        const postedDateText = await page.$eval('span[data-id="PostedDate"]', el => el.innerText.trim()).catch(() => null);

        return {
            'Tên công việc': title,
            'Tên công ty': company,
            'Nơi làm việc': location,
            'Mức lương': salary,
            'Ngày đăng tin': postedDateText,
            'Link': url
        };
    } catch (error) {
        console.error(` -> Lỗi khi cào dữ liệu từ ${url}: ${error.message}`);
        return null;
    } finally {
        if (page) await page.close();
    }
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    if (!CHROME_PATH) {
        throw new Error("Biến môi trường CHROME_PATH không được thiết lập.");
    }
    
    const allJobUrls = await getAllJobUrls();
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    if (allJobUrls.length > 0) {
        const proxyInfo = await getProxy(PROXY_API_KEY, PROXY_API_ENDPOINT);
        const launchOptions = {
            headless: true,
            executablePath: CHROME_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        };
        if (proxyInfo) {
            launchOptions.args.push(`--proxy-server=${proxyInfo.host}:${proxyInfo.port}`);
        }

        console.error(`--- Giai đoạn 3: Khởi tạo trình duyệt và bắt đầu khai thác ${allJobUrls.length} URL... ---`);
        const browser = await puppeteer.launch(launchOptions);
        
        for (const url of allJobUrls) {
            const jobData = await scrapeJobDetails(url, browser);
            if (jobData) {
                allJobs.push(jobData);
            }
        }
        await browser.close();
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/vieclam24h_sitemap-data_${timestamp}.csv`;
        jobsCount = allJobs.length;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ Vieclam24h vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }

    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
