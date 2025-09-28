const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30;
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const API_JOB_SEARCH = "https://apiv2.vieclam24h.vn/employer/fe/job/get-job-list";

// --- HÀM LẤY PROXY ---
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
            return { host, port: parseInt(port, 10), protocol: 'http' };
        }
        throw new Error(`Phản hồi API proxy không như mong đợi.`);
    } catch (error) {
        console.error(`-> [V24h-Điệp viên] Lỗi khi yêu cầu proxy mới: ${error.message}`);
        return null;
    }
}

// --- HÀM TIỆN ÍCH ---
function formatSalary(salary) { if (!salary) return "Thỏa thuận"; return salary; }
function formatDate(isoString) { if (!isoString) return null; return isoString.split(' ')[0]; }

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let currentPage = 1;
    let totalPages = 1;
    const proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);

    console.error(`\n--- Bắt đầu khai thác dữ liệu Vieclam24h cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) {
        try {
            console.error(`Đang khai thác trang ${currentPage}/${totalPages}...`);
            const requestOptions = {
                params: {
                    q: TARGET_KEYWORD, page: currentPage, per_page: JOBS_PER_PAGE,
                    sort_q: 'priority_max,desc', request_from: 'search_result_web',
                },
                headers: { 'User-Agent': FAKE_USER_AGENT },
                proxy: proxy
            };

            const response = await axios.get(API_JOB_SEARCH, requestOptions);
            
            const jobs = response.data?.data?.jobs;
            const pagination = response.data?.data?.pagination;
            if (currentPage === 1 && pagination?.total_pages) {
                totalPages = pagination.total_pages;
                console.error(`Phát hiện có tổng cộng ${pagination.total_records} tin tuyển dụng (${totalPages} trang).`);
            }
            if (!jobs || jobs.length === 0) {
                console.error("Không có dữ liệu ở trang này, dừng lại.");
                break;
            }
            const processedJobs = jobs.map(job => {
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
                    'Tên công việc': job.job_title, 'Tên công ty': job.company_name,
                    'Nơi làm việc': locationText, 'Mức lương': formatSalary(job.salary_text),
                    'Ngày đăng tin': formatDate(job.updated_at), 'Link': job.online_url
                };
            });
            allJobs.push(...processedJobs);
            currentPage++;
        } catch (error) {
            console.error(`Lỗi khi khai thác trang ${currentPage}:`, error.message);
            break;
        }
    }
    
    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        const finalFilename = `data/vieclam24h_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${allJobs.length} tin việc làm từ Vieclam24h vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
})();
