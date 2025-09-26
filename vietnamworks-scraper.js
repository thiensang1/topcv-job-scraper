const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

const TARGET_KEYWORD = "";
const JOBS_PER_PAGE = 50;
const API_JOB_SEARCH = "https://ms.vietnamworks.com/job-search/v1.0/search";
const API_META_DATA = "https://ms.vietnamworks.com/meta/v1.0/job-levels";

// --- HÀM HELPER ĐỂ GỬI OUTPUT RA WORKFLOW ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function formatSalary(min, max) {
    if (min === 0 && max === 0) return "Thỏa thuận";
    const format = (num) => new Intl.NumberFormat('vi-VN').format(num);
    if (min > 0 && max > 0) return `${format(min)} - ${format(max)} VND`;
    if (min > 0) return `Từ ${format(min)} VND`;
    if (max > 0) return `Lên đến ${format(max)} VND`;
    return "Thỏa thuận";
}

function formatDate(isoString) {
    if (!isoString) return null;
    return isoString.split('T')[0];
}

async function fetchJobLevels() {
    console.error("-> Đang tải dữ liệu meta về cấp bậc công việc...");
    try {
        const response = await axios.get(API_META_DATA);
        const jobLevels = new Map();
        const levelItems = response.data?.data?.relationships?.data;
        if (levelItems && Array.isArray(levelItems)) {
            levelItems.forEach(item => {
                if (item.id && item.attributes?.nameVi) {
                    jobLevels.set(item.id, item.attributes.nameVi);
                }
            });
        }
        console.error("-> Tải dữ liệu meta thành công!");
        return jobLevels;
    } catch (error) {
        console.error("Lỗi khi tải dữ liệu meta:", error.message);
        return new Map();
    }
}

async function scrapeAllJobs(jobLevelsMap) {
    let allJobs = [];
    let currentPage = 1; 
    let totalPages = 1;
    
    console.error(`\n--- Bắt đầu khai thác dữ liệu cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) { 
        try {
            console.error(`Đang khai thác trang ${currentPage}/${totalPages}...`);
            const requestBody = { query: TARGET_KEYWORD };
            const requestOptions = {
                params: { pageSize: JOBS_PER_PAGE, page: currentPage }
            };
            const response = await axios.post(API_JOB_SEARCH, requestBody, requestOptions);

            const jobs = response.data.data;
            const meta = response.data.meta;

            if (currentPage === 1) {
                totalPages = meta.nbPages;
                console.error(`Phát hiện có tổng cộng ${meta.nbHits} tin tuyển dụng (${totalPages} trang).`);
            }

            if (!jobs || jobs.length === 0) {
                console.error("Không có dữ liệu ở trang này, dừng lại.");
                break;
            }

            const processedJobs = jobs.map(job => ({
                'Tên công việc': job.jobTitle,
                'Tên công ty': job.companyName,
                'Cấp bậc': jobLevelsMap.get(job.jobLevelId) || 'Không xác định',
                'Mức lương (VND)': formatSalary(job.salaryMin, job.salaryMax),
                'Ngày đăng tin': formatDate(job.approvedOn),
                'Ngày hết hạn': formatDate(job.expiredOn),
                'Link': job.jobUrl
            }));

            allJobs.push(...processedJobs);
            currentPage++;

        } catch (error) {
            console.error(`Lỗi khi khai thác trang ${currentPage}:`, error.message);
            break;
        }
    }
    return allJobs;
}

(async () => {
    const jobLevels = await fetchJobLevels();
    const allJobs = await scrapeAllJobs(jobLevels);

    let jobsCount = 0;
    let finalFilename = "";

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
        finalFilename = `data/vietnamworks_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ VietnamWorks vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }

    // --- GỬI OUTPUT RA CHO WORKFLOW ---
    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
