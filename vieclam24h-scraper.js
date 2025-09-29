const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { stringify } = require('csv-stringify/sync');

const TARGET_KEYWORD = "kế toán";
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function scrapeVieclam24h() {
    let allJobs = [];
    let currentPage = 1;
    let totalPages = 1;

    console.error(`--- Bắt đầu chiến dịch "Khai Quật Dữ Liệu" cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) {
        try {
            const searchUrl = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}&page=${currentPage}`;
            console.error(` -> Đang khai quật trang kết quả: ${currentPage}...`);
            
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': FAKE_USER_AGENT }
            });

            const $ = cheerio.load(response.data);
            const nextDataScript = $('#__NEXT_DATA__').html();
            
            if (!nextDataScript) {
                throw new Error("Không tìm thấy kho báu '__NEXT_DATA__'.");
            }

            const jsonData = JSON.parse(nextDataScript);
            
            const jobsData = jsonData?.props?.pageProps?.data?.data;
            const jobs = jobsData?.jobs;
            
            if (currentPage === 1) {
                totalPages = jobsData?.pagination?.total_pages || 1;
                console.error(` -> Phân tích thành công! Tổng số trang cần khai quật: ${totalPages}`);
            }

            if (!jobs || jobs.length === 0) {
                console.error(" -> Không tìm thấy dữ liệu việc làm trong kho báu, kết thúc.");
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
                    'Tên công việc': job.job_title,
                    'Tên công ty': job.company_name,
                    'Nơi làm việc': locationText,
                    'Mức lương': job.salary_text || 'Thỏa thuận',
                    'Ngày đăng tin': job.updated_at ? job.updated_at.split(' ')[0] : null,
                    'Link': job.online_url
                };
            });
            
            allJobs.push(...processedJobs);
            console.error(` -> Đã khai quật được ${processedJobs.length} tin từ trang ${currentPage}.`);
            currentPage++;

        } catch (error) {
            console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
            break;
        }
    }

    let jobsCount = allJobs.length;
    let finalFilename = "";
    if (jobsCount > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/vieclam24h_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ Vieclam24h vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }

    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
}

scrapeVieclam24h();
