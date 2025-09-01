// --- PHIÊN BẢN CUỐI CÙNG: "BIỆT ĐỘI ĐẶC NHIỆM VÔ DANH" ---
// Mỗi "công nhân" sẽ tự yêu cầu một danh tính mới trước mỗi nhiệm vụ.
// File: collector.js

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios'); // Thư viện để gọi API

puppeteer.use(StealthPlugin());

// --- GIAI ĐOẠN 1: YÊU CẦU DANH TÍNH MỚI ---
async function getNewProxy(apiKey) {
    console.log("-> Đang yêu cầu một danh tính proxy mới từ API...");
    try {
        const response = await axios.get(`https://api.kiotproxy.com/api/v1/proxies/new`, {
            params: {
                key: apiKey,
                region: 'random' // Lấy ngẫu nhiên trên toàn hệ thống
            },
            timeout: 10000 // Chờ tối đa 10 giây
        });

        if (response.data && response.data.data && response.data.data.proxy) {
            const proxyData = response.data.data.proxy;
            const [host, port, user, pass] = proxyData.split(':');
            console.log(`-> Đã nhận danh tính mới thành công: ${host}:${port}`);
            return { host, port, user, pass };
        } else {
            throw new Error('Phản hồi từ API proxy không hợp lệ.');
        }
    } catch (error) {
        console.error(`Lỗi nghiêm trọng khi yêu cầu proxy mới: ${error.message}`);
        return null; // Trả về null nếu không lấy được proxy
    }
}


async function scrapeTopCV(keyword, startPage, endPage, workerId) {
    const PROXY_API_KEY = process.env.PROXY_API_KEY;
    if (!PROXY_API_KEY) {
        console.error("Lỗi: Không tìm thấy PROXY_API_KEY. Hãy chắc chắn bạn đã thiết lập nó trong GitHub Secrets.");
        return [];
    }
    
    const proxyInfo = await getNewProxy(PROXY_API_KEY);
    if (!proxyInfo) {
        console.error("-> Không thể tiếp tục vì không có proxy.");
        return [];
    }

    let browser = null;
    const collectedJobs = [];

    try {
        console.log("Đang khởi tạo trình duyệt Puppeteer Stealth với danh tính mới...");
        browser = await puppeteer.launch({
            headless: true,
            args: [
                `--proxy-server=${proxyInfo.host}:${proxyInfo.port}`,
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        const page = await browser.newPage();
        
        await page.authenticate({
            username: proxyInfo.user,
            password: proxyInfo.pass
        });
        
        await page.setViewport({ width: 1920, height: 1080 });
        
        const base_url = "https://www.topcv.vn";

        for (let i = startPage; i <= endPage; i++) {
            const targetUrl = `${base_url}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${i}&category_family=r392~b393`;
            console.log(`   [Worker ${workerId}] Đang truy cập trang ${i}...`);
            
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

                const jobListSelector = 'div.job-list-search-result';
                await page.waitForSelector(jobListSelector, { timeout: 30000 });
                
                let previousHtml = '';
                let currentHtml = '';
                let stabilityCounter = 0;
                for (let check = 0; check < 10; check++) {
                    currentHtml = await page.$eval(jobListSelector, element => element.innerHTML);
                    if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
                        stabilityCounter++;
                        if (stabilityCounter >= 2) break;
                    } else {
                        stabilityCounter = 0;
                    }
                    previousHtml = currentHtml;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                const content = await page.content();
                const $ = cheerio.load(content);
                const jobListings = $('div[class*="job-item"]');

                if (jobListings.length === 0) {
                    console.log(`   [Worker ${workerId}] Không tìm thấy tin tuyển dụng nào trên trang ${i}, kết thúc nhiệm vụ.`);
                    break;
                }

                jobListings.each((index, element) => {
                    const titleTag = $(element).find('h3[class*="title"] a');
                    const salaryTag = $(element).find('.title-salary');
                    const companyLogoTag = $(element).find('img.w-100.lazy');
                    const dateContainerTag = $(element).find('span.hidden-on-quick-view');
                    const locationTag = $(element).find('.city-text');
                    const expTag = $(element).find('.exp');
                    
                    let companyText = null;
                    if (companyLogoTag.length) {
                        companyText = companyLogoTag.attr('alt');
                        if(companyText) companyText = companyText.trim();
                    }

                    let dateText = null;
                    if (dateContainerTag.length) {
                        const nextNode = dateContainerTag[0].nextSibling;
                        if (nextNode && nextNode.type === 'text') {
                            dateText = nextNode.data.trim();
                        }
                    }
                    
                    let expText = null;
                    if (expTag.length) {
                        expText = expTag.text().trim();
                    }

                    collectedJobs.push({
                        'keyword': keyword,
                        'title': titleTag.text().trim() || null,
                        'link': titleTag.attr('href') ? `${base_url}${titleTag.attr('href')}` : null,
                        'company': companyText,
                        'salary': salaryTag.text().trim() || 'Thỏa thuận',
                        'Nơi làm việc': locationTag.text().trim() || null,
                        'thời gian đăng': dateText,
                        'Kinh nghiệm làm việc tối thiểu': expText,
                    });
                });
                console.log(`   [Worker ${workerId}] Đã thu thập ${jobListings.length} tin từ trang ${i}.`);

            } catch (error) {
                console.error(`   [Worker ${workerId}] Lỗi khi xử lý trang ${i}: ${error.message}`);
                break; 
            }
        }
    } catch (error) {
        console.error(`[Worker ${workerId}] Lỗi không xác định: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
            console.log(`[Worker ${workerId}] Đã đóng trình duyệt và "biến mất".`);
        }
    }
    return collectedJobs;
}

(async () => {
    const args = process.argv.slice(2);
    const keyword = args[0];
    const startPage = parseInt(args[1], 10);
    const endPage = parseInt(args[2], 10);
    const workerId = args[3];

    if (!keyword || isNaN(startPage) || isNaN(endPage) || !workerId) {
        console.error("Sử dụng: node collector.js [keyword] [startPage] [endPage] [workerId]");
        process.exit(1);
    }
    
    console.log(`--- [Worker ${workerId}] Bắt đầu nhiệm vụ: Thu thập '${keyword}' từ trang ${startPage} đến ${endPage} ---`);
    const results = await scrapeTopCV(keyword, startPage, endPage, workerId);

    if (results.length > 0) {
        const outputFilename = `results_worker_${workerId}.csv`;
        const csvData = stringify(results, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.log(`[Worker ${workerId}] Đã hoàn thành nhiệm vụ. Lưu ${results.length} kết quả vào ${outputFilename}`);
    } else {
        console.log(`[Worker ${workerId}] Không thu thập được dữ liệu nào.`);
    }
})();

