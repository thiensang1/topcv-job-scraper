const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

// --- HÀM LẤY PROXY (Tái sử dụng từ script TopCV) ---
async function getProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("-> Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.error("-> [V24h] Đang yêu cầu một danh tính proxy MỚI từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 20000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`-> [V24h] Đã nhận proxy mới thành công: ${host}:${port}`);
            return { host, port: parseInt(port, 10), protocol: 'http' };
        }
        throw new Error(`Phản hồi API proxy không như mong đợi.`);
    } catch (error) {
        console.error(`-> [V24h] Lỗi khi yêu cầu proxy mới: ${error.message}`);
        return null;
    }
}


// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";
    
    // Lấy proxy ngay từ đầu
    const proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);

    try {
        console.error(`--- Bắt đầu chiến dịch "Khai Quật Dữ Liệu" cho từ khóa: "${TARGET_KEYWORD}" ---`);
        const searchUrl = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}`;
        
        console.error(" -> Đang tải dữ liệu trang đích...");
        
        // Tạo cấu hình request, bao gồm cả proxy và user-agent
        const requestOptions = {
            headers: { 'User-Agent': FAKE_USER_AGENT },
            proxy: proxy // <-- SỬ DỤNG PROXY CHO AXIOS
        };

        const response = await axios.get(searchUrl, requestOptions);

        const $ = cheerio.load(response.data);
        const nextDataScript = $('#__NEXT_DATA__').html();
        
        if (!nextDataScript) {
            throw new Error("Không tìm thấy kho báu '__NEXT_DATA__'.");
        }

        const jsonData = JSON.parse(nextDataScript);
        const jobs = jsonData?.props?.pageProps?.data?.data?.jobs;

        if (!jobs || jobs.length === 0) {
            throw new Error("Không tìm thấy danh sách việc làm bên trong '__NEXT_DATA__'.");
        }
        
        allJobs = jobs.map(job => {
            let locationText = 'Không xác định';
            try {
                if (job.places && typeof job.places === 'string') {
                    const locationsArray = JSON.parse(job.places);
                    if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                        locationText = locationsArray.map(loc => loc.address).join('; ');
                    }
                }
            } catch (e) { /* Bỏ qua lỗi parsing */ }

            return {
                'Tên công việc': job.job_title,
                'Tên công ty': job.company_name,
                'Nơi làm việc': locationText,
                'Mức lương': job.salary_text || 'Thỏa thuận',
                'Ngày đăng tin': job.updated_at ? job.updated_at.split(' ')[0] : null,
                'Link': job.online_url
            };
        });

    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/vieclam24h_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
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
