// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-sun-rain;

// ============================================================================
// Taiwan Weather — a self-calibrating forecast widget for Scriptable (iOS)
//
//  * CWA (中央氣象署) township forecast + 7 numerical models via Open-Meteo
//  * Live correction from the nearest CWA automatic weather station
//  * Learns on-device: logs every forecast, verifies against station
//    observations, and re-weights / de-biases each source over time.
//
// Setup: see README.md. First run inside the Scriptable app asks for your
// CWA API key (free from https://opendata.cwa.gov.tw).
// ============================================================================

const CONFIG = {
  // Used when location is unavailable (e.g. widget without location permission).
  fallbackLocation: { latitude: 25.0330, longitude: 121.5654 }, // Taipei 101
  // Open-Meteo models that cover Taiwan, with prior expected temp MAE (°C).
  models: {
    jma_msm: 1.3,              // JMA 5 km regional
    ecmwf_ifs: 1.3,            // ECMWF 9 km
    ecmwf_aifs025_single: 1.4, // ECMWF AI model
    icon_seamless: 1.6,        // DWD ICON
    gfs_seamless: 1.7,         // NOAA GFS
    ukmo_seamless: 1.6,        // UK Met Office
    cma_grapes_global: 1.8,    // China CMA
  },
  cwaPriorMae: 1.0,            // CWA's own township forecast prior
  priorStrength: 24,           // how many samples the prior is "worth"
  nowcastDecayHours: 4,        // e-folding time for station-based correction
  maxStationKm: 25,            // farther than this from any CWA station = outside Taiwan
  historyDays: 21,             // how long verification data is kept
  hoursShown: 8,
};

// CWA county → 3-day township forecast dataset ID (F-D0047-xxx)
const COUNTY_DATASET = {
  "宜蘭縣": "001", "桃園市": "005", "新竹縣": "009", "苗栗縣": "013",
  "彰化縣": "017", "南投縣": "021", "雲林縣": "025", "嘉義縣": "029",
  "屏東縣": "033", "臺東縣": "037", "花蓮縣": "041", "澎湖縣": "045",
  "基隆市": "049", "新竹市": "053", "嘉義市": "057", "臺北市": "061",
  "高雄市": "065", "新北市": "069", "臺中市": "073", "臺南市": "077",
  "連江縣": "081", "金門縣": "085",
};

// Each county's CWA township forecast points ("LocationName lat lon|..." from F-D0047-xxx, fetched
// 2026-10-07). Used to pick the user's township; test/harness.mjs checks them against the live API.
const TOWNS = {
  "宜蘭縣": "宜蘭市 24.7537 121.7451|羅東鎮 24.6787 121.7588|蘇澳鎮 24.5962 121.8338|頭城鎮 24.8611 121.8153|礁溪鄉 24.8253 121.7632|壯圍鄉 24.7487 121.7774|員山鄉 24.7453 121.7151|冬山鄉 24.6363 121.7840|五結鄉 24.6866 121.7901|三星鄉 24.6674 121.6457|大同鄉 24.6790 121.6011|南澳鄉 24.4679 121.7959",
  "桃園市": "桃園區 24.9957 121.2935|中壢區 24.9675 121.2169|大溪區 24.8823 121.2789|楊梅區 24.9094 121.1376|蘆竹區 25.0487 121.2871|大園區 25.0657 121.1873|龜山區 24.9943 121.3297|八德區 24.9307 121.2764|龍潭區 24.8726 121.2141|平鎮區 24.9474 121.2100|新屋區 24.9743 121.0973|觀音區 25.0382 121.0737|復興區 24.8203 121.3434",
  "新竹縣": "竹北市 24.8412 120.9957|竹東鎮 24.7385 121.0835|新埔鎮 24.8297 121.0631|關西鎮 24.7942 121.1676|湖口鄉 24.9027 121.0398|新豐鄉 24.9025 120.9773|芎林鄉 24.7751 121.0737|橫山鄉 24.7186 121.1333|北埔鄉 24.7037 121.0482|寶山鄉 24.7674 120.9830|峨眉鄉 24.6905 121.0114|尖石鄉 24.7070 121.1933|五峰鄉 24.6339 121.1114",
  "苗栗縣": "苗栗市 24.5633 120.8110|苑裡鎮 24.4414 120.6450|通霄鎮 24.4931 120.6761|竹南鎮 24.6857 120.8653|頭份市 24.6879 120.9048|後龍鎮 24.6154 120.7838|卓蘭鎮 24.3146 120.8164|大湖鄉 24.4252 120.8580|公館鄉 24.5076 120.8203|銅鑼鄉 24.4888 120.7797|南庄鄉 24.5989 120.9922|頭屋鄉 24.5795 120.8429|三義鄉 24.4146 120.7620|西湖鄉 24.5584 120.7492|造橋鄉 24.6402 120.8573|三灣鄉 24.6549 120.9486|獅潭鄉 24.5413 120.9119|泰安鄉 24.4490 120.8998",
  "彰化縣": "彰化市 24.0826 120.5341|鹿港鎮 24.0590 120.4269|和美鎮 24.1102 120.4861|線西鄉 24.1323 120.4626|伸港鄉 24.1616 120.4780|福興鄉 24.0497 120.4357|秀水鄉 24.0370 120.4947|花壇鄉 24.0314 120.5301|芬園鄉 24.0154 120.6208|員林市 23.9608 120.5662|溪湖鎮 23.9679 120.4754|田中鎮 23.8632 120.5728|大村鄉 23.9952 120.5391|埔鹽鄉 24.0020 120.4554|埔心鄉 23.9547 120.5354|永靖鄉 23.9264 120.5396|社頭鄉 23.8985 120.5777|二水鄉 23.8084 120.6108|北斗鎮 23.8633 120.5137|二林鎮 23.9015 120.3662|田尾鄉 23.8939 120.5178|埤頭鄉 23.8933 120.4540|芳苑鄉 23.9261 120.3122|大城鄉 23.8540 120.3128|竹塘鄉 23.8622 120.4197|溪州鄉 23.8534 120.4909",
  "南投縣": "南投市 23.9133 120.6792|埔里鎮 23.9683 120.9611|草屯鎮 23.9755 120.6721|竹山鎮 23.7594 120.6633|集集鎮 23.8302 120.7784|名間鄉 23.8401 120.6949|鹿谷鄉 23.7474 120.7454|中寮鄉 23.8807 120.7580|魚池鄉 23.8975 120.9275|國姓鄉 24.0419 120.8493|水里鄉 23.8131 120.8478|信義鄉 23.6986 120.8464|仁愛鄉 24.0232 121.1241",
  "雲林縣": "斗六市 23.6988 120.5189|斗南鎮 23.6817 120.4695|虎尾鎮 23.7100 120.4372|西螺鎮 23.7995 120.4575|土庫鎮 23.6796 120.3843|北港鎮 23.5777 120.2943|古坑鄉 23.6446 120.5539|大埤鄉 23.6475 120.4232|莿桐鄉 23.7628 120.4943|林內鄉 23.7579 120.6047|二崙鄉 23.7729 120.4047|崙背鄉 23.7642 120.3510|麥寮鄉 23.7556 120.2435|東勢鄉 23.6768 120.2445|褒忠鄉 23.6928 120.2953|臺西鄉 23.7022 120.1887|元長鄉 23.6514 120.3070|四湖鄉 23.6399 120.2163|口湖鄉 23.5842 120.1773|水林鄉 23.5746 120.2380",
  "嘉義縣": "太保市 23.4602 120.3240|朴子市 23.4599 120.2378|布袋鎮 23.3798 120.1588|大林鎮 23.6057 120.4630|民雄鄉 23.5532 120.4204|溪口鄉 23.6043 120.3842|新港鄉 23.5538 120.3393|六腳鄉 23.4949 120.2836|東石鄉 23.4605 120.1456|義竹鄉 23.3380 120.2352|鹿草鄉 23.4131 120.3001|水上鄉 23.4302 120.3901|中埔鄉 23.4268 120.5148|竹崎鄉 23.5247 120.5433|梅山鄉 23.5867 120.5476|番路鄉 23.4663 120.5460|大埔鄉 23.2966 120.5856|阿里山鄉 23.4732 120.7053",
  "屏東縣": "屏東市 22.6642 120.4834|潮州鎮 22.5516 120.5349|東港鎮 22.4684 120.4462|恆春鎮 22.0056 120.7393|萬丹鄉 22.5913 120.4771|長治鄉 22.6783 120.5192|麟洛鄉 22.6523 120.5190|九如鄉 22.7420 120.4823|里港鄉 22.7809 120.4864|鹽埔鄉 22.7562 120.5646|高樹鄉 22.8283 120.5923|萬巒鄉 22.5745 120.5597|內埔鄉 22.6138 120.5587|竹田鄉 22.5865 120.5360|新埤鄉 22.4720 120.5418|枋寮鄉 22.3673 120.5854|新園鄉 22.5456 120.4535|崁頂鄉 22.5165 120.5061|林邊鄉 22.4367 120.5063|南州鄉 22.4922 120.5017|佳冬鄉 22.4210 120.5444|琉球鄉 22.3548 120.3742|車城鄉 22.0755 120.7062|滿州鄉 22.0226 120.8306|枋山鄉 22.2658 120.6444|三地門鄉 22.7294 120.6782|霧臺鄉 22.7508 120.6710|瑪家鄉 22.7103 120.6413|泰武鄉 22.5936 120.6238|來義鄉 22.5279 120.6235|春日鄉 22.3727 120.6210|獅子鄉 22.2035 120.6974|牡丹鄉 22.1281 120.7662",
  "臺東縣": "臺東市 22.7565 121.1387|成功鎮 23.1020 121.3716|關山鎮 23.0492 121.1550|卑南鄉 22.7843 121.0790|鹿野鄉 22.9416 121.1436|池上鄉 23.1240 121.2070|東河鄉 22.9705 121.2946|長濱鄉 23.3168 121.4433|太麻里鄉 22.6173 120.9996|大武鄉 22.3423 120.8820|綠島鄉 22.6707 121.4605|海端鄉 23.1038 121.1686|延平鄉 22.9041 121.0776|金峰鄉 22.5965 120.9528|達仁鄉 22.2986 120.8749|蘭嶼鄉 22.0247 121.5578",
  "花蓮縣": "花蓮市 23.9839 121.5986|鳳林鎮 23.7465 121.4437|玉里鎮 23.3373 121.3072|新城鄉 24.0413 121.5962|吉安鄉 23.9748 121.5555|壽豐鄉 23.8720 121.5007|光復鄉 23.6711 121.4151|豐濱鄉 23.6031 121.5130|瑞穗鄉 23.4985 121.3679|富里鄉 23.1812 121.2421|秀林鄉 24.1206 121.6167|萬榮鄉 23.7166 121.4028|卓溪鄉 23.3483 121.2953",
  "澎湖縣": "馬公市 23.5676 119.5707|湖西鄉 23.5854 119.6446|白沙鄉 23.6682 119.5905|西嶼鄉 23.6027 119.4988|望安鄉 23.3591 119.4924|七美鄉 23.2084 119.4165",
  "基隆市": "中正區 25.1532 121.7594|七堵區 25.0976 121.7050|暖暖區 25.1019 121.7277|仁愛區 25.1294 121.7326|中山區 25.1547 121.7215|安樂區 25.1228 121.7150|信義區 25.1313 121.7431",
  "新竹市": "東區 24.8070 120.9653|北區 24.8181 120.9621|香山區 24.7988 120.9338",
  "嘉義市": "東區 23.4804 120.4454|西區 23.4663 120.4273",
  "臺北市": "松山區 25.0516 121.5690|信義區 25.0351 121.5587|大安區 25.0282 121.5264|中山區 25.0663 121.5253|中正區 25.0461 121.5166|大同區 25.0680 121.5072|萬華區 25.0367 121.4916|文山區 24.9914 121.5618|南港區 25.0563 121.5985|內湖區 25.0712 121.5807|士林區 25.0946 121.5115|北投區 25.1341 121.4946",
  "高雄市": "鹽埕區 22.6265 120.2787|鼓山區 22.6386 120.2730|左營區 22.6916 120.2870|楠梓區 22.7303 120.3183|三民區 22.6494 120.2917|新興區 22.6328 120.3019|前金區 22.6292 120.2861|苓雅區 22.6235 120.3041|前鎮區 22.5883 120.3102|旗津區 22.6127 120.2599|小港區 22.5672 120.3301|鳳山區 22.6289 120.3543|林園區 22.5097 120.3867|大寮區 22.6071 120.3874|大樹區 22.6951 120.4250|大社區 22.7318 120.3386|仁武區 22.7031 120.3396|鳥松區 22.6616 120.3563|岡山區 22.7991 120.2869|橋頭區 22.7593 120.2977|燕巢區 22.7951 120.3540|田寮區 22.8716 120.3513|阿蓮區 22.8849 120.3192|路竹區 22.8564 120.2512|湖內區 22.9101 120.2036|茄萣區 22.9085 120.1744|永安區 22.8200 120.2162|彌陀區 22.7832 120.2426|梓官區 22.7625 120.2592|旗山區 22.8904 120.4754|美濃區 22.8965 120.5338|六龜區 23.0002 120.6246|甲仙區 23.0858 120.5798|杉林區 22.9735 120.5319|內門區 22.9446 120.4546|茂林區 22.8881 120.6556|桃源區 23.1610 120.7561|那瑪夏區 23.2400 120.6887",
  "新北市": "板橋區 25.0115 121.4509|三重區 25.0627 121.4801|中和區 25.0004 121.4928|永和區 25.0109 121.5120|新莊區 25.0376 121.4423|新店區 24.9692 121.5334|樹林區 24.9917 121.4166|鶯歌區 24.9578 121.3462|三峽區 24.9361 121.3608|淡水區 25.1889 121.4357|汐止區 25.0656 121.6507|瑞芳區 25.1107 121.8018|土城區 24.9742 121.4347|蘆洲區 25.0867 121.4657|五股區 25.0850 121.4297|泰山區 25.0611 121.4233|林口區 25.0787 121.3806|深坑區 25.0042 121.6077|石碇區 24.9933 121.6497|坪林區 24.9379 121.7036|三芝區 25.2596 121.4926|石門區 25.2931 121.5594|八里區 25.1512 121.3932|平溪區 25.0284 121.7300|雙溪區 25.0356 121.8575|貢寮區 25.0236 121.9021|金山區 25.2242 121.6283|萬里區 25.1798 121.6814|烏來區 24.8737 121.5400",
  "臺中市": "中區 24.1457 120.6712|東區 24.1384 120.6955|南區 24.1188 120.6557|西區 24.1429 120.6629|北區 24.1677 120.6740|西屯區 24.1673 120.6256|南屯區 24.1401 120.6346|北屯區 24.1847 120.6784|豐原區 24.2439 120.7100|東勢區 24.2603 120.8198|大甲區 24.3508 120.6143|清水區 24.2702 120.5516|沙鹿區 24.2351 120.5581|梧棲區 24.2567 120.5237|后里區 24.3067 120.7026|神岡區 24.2596 120.6532|潭子區 24.2112 120.6970|大雅區 24.2309 120.6397|新社區 24.2355 120.8014|石岡區 24.2767 120.7719|外埔區 24.3338 120.6462|大安區 24.3480 120.5784|烏日區 24.1065 120.6156|大肚區 24.1529 120.5376|龍井區 24.1943 120.5376|霧峰區 24.0628 120.6920|太平區 24.1282 120.7102|大里區 24.1012 120.6695|和平區 24.1766 120.8755",
  "臺南市": "新營區 23.3118 120.3084|鹽水區 23.3218 120.2581|白河區 23.3531 120.4075|柳營區 23.2803 120.3037|後壁區 23.3678 120.3532|東山區 23.3279 120.3964|麻豆區 23.1867 120.2504|下營區 23.2374 120.2562|六甲區 23.2335 120.3394|官田區 23.1950 120.3072|大內區 23.1207 120.3489|佳里區 23.1670 120.1690|學甲區 23.2322 120.1742|西港區 23.1247 120.1954|七股區 23.1425 120.1313|將軍區 23.2006 120.1506|北門區 23.2695 120.1173|新化區 23.0403 120.3028|善化區 23.1341 120.2886|新市區 23.0807 120.2870|安定區 23.1233 120.2289|山上區 23.1053 120.3445|玉井區 23.1255 120.4520|楠西區 23.1759 120.4783|南化區 23.0448 120.4697|左鎮區 23.0587 120.4007|仁德區 22.9742 120.2436|歸仁區 22.9688 120.2858|關廟區 22.9646 120.3197|龍崎區 22.9652 120.3567|永康區 23.0279 120.2489|東區 22.9820 120.2159|南區 22.9629 120.1806|北區 23.0014 120.1948|安南區 23.0490 120.1766|安平區 22.9964 120.1604|中西區 22.9940 120.1976",
  "連江縣": "南竿鄉 26.1542 119.9293|北竿鄉 26.2269 119.9885|莒光鄉 25.9736 119.9246|東引鄉 26.3692 120.4816",
  "金門縣": "金城鎮 24.4344 118.3124|金沙鎮 24.4906 118.4050|金湖鎮 24.4430 118.4089|金寧鄉 24.4526 118.3267|烈嶼鄉 24.4312 118.2363|烏坵鄉 24.9928 119.4460",
};
const TOWN_POINTS = Object.entries(TOWNS).flatMap(([county, list]) => list.split("|").map((t) => {
  const [name, lat, lon] = t.split(" ");
  return { county, name, latitude: Number(lat), longitude: Number(lon) };
}));

const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/";
const KEYCHAIN_KEY = "CWA_API_KEY";
const LEAD_BUCKETS = [[0, 6], [6, 24], [24, 48]];
const DRY_6H = -98; // CWA rain code: no rain in the past 6 hours

// ---------------------------------------------------------------------------
// Time helpers — all hour keys are Taiwan local time "YYYY-MM-DDTHH"
// ---------------------------------------------------------------------------
const HOUR = 3600e3;
function hourKey(date) {
  return new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 13);
}
function keyToDate(key) {
  return new Date(Date.parse(key + ":00:00+08:00"));
}
function addHours(key, h) {
  return hourKey(new Date(keyToDate(key).getTime() + h * HOUR));
}
function leadBucket(lead) {
  return LEAD_BUCKETS.findIndex(([a, b]) => lead >= a && lead < b);
}
function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > -90 ? n : null; // CWA uses -99 / -999 for missing
}
// Today's rain so far (mm). CWA codes: "T" = trace, -98 = dry for 6 h, -99 / "X" = missing.
function rainAcc(v) {
  if (v === "T") return 0;
  return Number(v) === DRY_6H ? DRY_6H : num(v);
}
// Station weather text, or null when none was observed ("-99", "-", "X").
function wxText(v) {
  const s = v == null ? "" : String(v).trim();
  return /^(-99|-|X)?$/.test(s) ? null : s;
}
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// ---------------------------------------------------------------------------
// Sky and comfort
// ---------------------------------------------------------------------------
const RAD = Math.PI / 180;
const SUN_DOWN = Math.cos(90.833 * RAD); // horizon incl. refraction + sun radius, like sunrise tables
// Equation of time (minutes) and solar declination (radians) on a date (NOAA).
function solar(d) {
  const g = (2 * Math.PI / 365) * ((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (24 * HOUR) - 0.5);
  return {
    eqTime: 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)),
    decl: 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g),
  };
}
// Is the sun below the horizon at the middle of hour `key`?
function isNight(key, loc) {
  const d = new Date(keyToDate(key).getTime() + HOUR / 2);
  const { eqTime, decl } = solar(d);
  const solarMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + eqTime + 4 * loc.longitude;
  const hourAngle = (solarMinutes / 4 - 180) * RAD, lat = loc.latitude * RAD;
  return Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle) < SUN_DOWN;
}
// Sunrise and sunset on a Taiwan-time day "YYYY-MM-DD", as minutes after local midnight (±2 min).
function sunTimes(day, loc) {
  const { eqTime, decl } = solar(keyToDate(day + "T12"));
  const lat = loc.latitude * RAD;
  const cosH = (SUN_DOWN - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const h = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD; // degrees; 4 minutes each
  const noon = 720 - 4 * loc.longitude - eqTime + 8 * 60;      // solar noon in Taiwan time
  return { rise: noon - 4 * h, set: noon + 4 * h };
}
const MOON_PHASES = [["New Moon", "🌑"], ["Waxing Crescent", "🌒"], ["First Quarter", "🌓"], ["Waxing Gibbous", "🌔"],
  ["Full Moon", "🌕"], ["Waning Gibbous", "🌖"], ["Last Quarter", "🌗"], ["Waning Crescent", "🌘"]];
// Moon phase from the mean lunar month (within about a day of the true phase).
function moonPhase(date) {
  const month = 29.530588853, newMoon = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
  const age = (((date - newMoon) / (24 * HOUR)) % month + month) % month;
  const [name, emoji] = MOON_PHASES[Math.round((age / month) * 8) % 8];
  const toFull = (month / 2 - age + month) % month;
  return { name, emoji, lit: (1 - Math.cos((2 * Math.PI * age) / month)) / 2,
    nextFull: new Date(date.getTime() + toFull * 24 * HOUR) };
}
// Feels-like temperature (Steadman's apparent temperature, as CWA's 體感溫度): °C, % humidity, m/s wind.
function feelsLike(t, rh, wind) {
  const vapour = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t)); // hPa
  return t + 0.33 * vapour - 0.7 * wind - 4;
}
function dewPoint(t, rh) { // Magnus formula
  const g = Math.log(rh / 100) + (17.625 * t) / (243.04 + t);
  return (243.04 * g) / (17.625 - g);
}
// Beaufort force (蒲福風級) for a wind speed in m/s.
function beaufort(ms) {
  const upper = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const i = upper.findIndex((x) => ms < x);
  return i < 0 ? 12 : i;
}
function compass(deg) {
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][
    Math.round(deg / 22.5) % 16];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function storage() {
  // On the device, not iCloud: works with iCloud Drive off or full, and each device learns its own places.
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.documentsDirectory(), "taiwan-weather");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  const file = fm.joinPath(dir, "state.json");
  return {
    async load() {
      try {
        if (!fm.fileExists(file)) return null;
        return JSON.parse(fm.readString(file));
      } catch (e) { return null; }
    },
    save(state) { fm.writeString(file, JSON.stringify(state)); },
  };
}

function emptyState() {
  // forecasts[validHour][source][bucket] = { t, pop }
  // obs[hour] = { t, acc, station }
  // stations = { time, list: [[id, latitude, longitude]] }: CWA station positions, refreshed weekly
  return { version: 1, forecasts: {}, obs: {}, stations: null, lastLocation: null, lastResult: null };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function getJSON(url) {
  const req = new Request(url);
  req.timeoutInterval = 20;
  return await req.loadJSON();
}

async function getLocation(state) {
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await Location.current();
    return { latitude: loc.latitude, longitude: loc.longitude };
  } catch (e) {
    return state.lastLocation || CONFIG.fallbackLocation;
  }
}

async function fetchStations(key, ids) {
  const url = CWA_BASE + "O-A0001-001?Authorization=" + encodeURIComponent(key) +
    (ids ? "&StationId=" + ids.join(",") : "") +
    "&WeatherElement=AirTemperature,Weather,Now,DailyHigh,DailyLow,RelativeHumidity,WindSpeed,WindDirection,GustInfo" +
    "&GeoInfo=Coordinates,CountyName,TownName";
  const data = await getJSON(url);
  if (!data.records) throw new Error("CWA stations: " + (data.message || "bad response"));
  return data.records.Station.map((s) => {
    const coords = s.GeoInfo.Coordinates.find((c) => c.CoordinateName === "WGS84") || s.GeoInfo.Coordinates[0] || {};
    const we = s.WeatherElement || {};
    const daily = we.DailyExtreme || {};
    return {
      id: s.StationId,
      name: s.StationName,
      county: s.GeoInfo.CountyName,
      town: s.GeoInfo.TownName,
      latitude: num(coords.StationLatitude),
      longitude: num(coords.StationLongitude),
      time: s.ObsTime && s.ObsTime.DateTime,
      t: num(we.AirTemperature),
      hi: num(daily.DailyHigh?.TemperatureInfo?.AirTemperature), // observed so far today
      lo: num(daily.DailyLow?.TemperatureInfo?.AirTemperature),
      acc: rainAcc(we.Now && we.Now.Precipitation), // rainfall accumulated today (mm)
      weather: wxText(we.Weather),
      rh: num(we.RelativeHumidity),
      wind: num(we.WindSpeed), // m/s
      windDir: num(we.WindDirection) <= 360 ? num(we.WindDirection) : null, // 990 = variable
      gust: num(we.GustInfo?.PeakGustSpeed),
    };
  });
}

function nearestStation(stations, loc) {
  let best = null;
  for (const s of stations) {
    if (s.t == null || s.latitude == null) continue;
    const d = distanceKm(loc, s);
    if (!best || d < best.distance) best = { ...s, distance: d };
  }
  return best;
}

// Readings of the stations nearest to loc. The full list (~900 stations, ~65 KB) is fetched once a
// week; other runs ask CWA for just the 3 nearest (~1 KB), unless none of them has a reading.
async function getStations(key, state, loc) {
  const cache = state.stations;
  if (cache && Date.now() - Date.parse(cache.time) < 7 * 24 * HOUR) {
    const ids = cache.list
      .map(([id, latitude, longitude]) => ({ id, d: distanceKm(loc, { latitude, longitude }) }))
      .sort((a, b) => a.d - b.d).slice(0, 3).map((s) => s.id);
    const near = await fetchStations(key, ids);
    if (near.some((s) => s.t != null && s.latitude != null)) return near;
  }
  const all = await fetchStations(key);
  state.stations = { time: new Date().toISOString(),
    list: all.filter((s) => s.latitude != null).map((s) => [s.id, s.latitude, s.longitude]) };
  return all;
}

// The township whose CWA forecast point (its centre) is nearest.
function nearestTown(loc) {
  let best = null;
  for (const t of TOWN_POINTS) {
    const d = distanceKm(loc, t);
    if (!best || d < best.distance) best = { ...t, distance: d };
  }
  return best;
}

// The CWA township at loc. Apple's geocoder knows the real borders, so its answer wins when its names
// match a CWA township; otherwise the nearest township centre. Reused while within 1 km.
async function findTown(loc, state) {
  const last = state.place;
  if (last && distanceKm(loc, last) < 1) return last;
  let match = null;
  try {
    const names = (await Location.reverseGeocode(loc.latitude, loc.longitude, "zh_TW"))
      .flatMap((p) => Object.values(p)).filter((v) => typeof v === "string").map((v) => v.replace(/台/g, "臺"));
    match = TOWN_POINTS.find((t) => names.includes(t.county) && names.includes(t.name));
  } catch (e) { /* offline or no answer: use the nearest centre */ }
  const town = match ? { ...match, via: "Apple Maps" } : { ...nearestTown(loc), via: "nearest township centre" };
  state.place = { county: town.county, name: town.name, via: town.via, distance: distanceKm(loc, town),
    latitude: loc.latitude, longitude: loc.longitude };
  return state.place;
}

// Expand a CWA WeatherElement into hourly values.
function cwaElementHourly(el) {
  const out = {};
  const points = [];
  for (const t of el.Time || []) {
    const ev = (t.ElementValue || [])[0] || {};
    const val = ev.Temperature ?? ev.ProbabilityOfPrecipitation ?? ev.Weather ?? Object.values(ev)[0];
    if (t.DataTime) {
      points.push({ key: hourKey(new Date(t.DataTime)), val });
    } else if (t.StartTime && t.EndTime) {
      let k = hourKey(new Date(t.StartTime));
      const end = hourKey(new Date(t.EndTime));
      while (k < end) { out[k] = val; k = addHours(k, 1); }
    }
  }
  // instantaneous points: linear interpolation for numbers
  points.sort((a, b) => (a.key < b.key ? -1 : 1));
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[i + 1];
    out[p.key] = p.val;
    if (!q) continue;
    const a = num(p.val), b = num(q.val);
    const span = (keyToDate(q.key) - keyToDate(p.key)) / HOUR;
    for (let h = 1; h < span; h++) {
      out[addHours(p.key, h)] = a != null && b != null ? a + ((b - a) * h) / span : p.val;
    }
  }
  return out;
}

async function fetchCWAForecast(key, county, town, loc) {
  const id = COUNTY_DATASET[county];
  if (!id) throw new Error("Unknown county " + county);
  const url = CWA_BASE + "F-D0047-" + id + "?Authorization=" + encodeURIComponent(key) +
    "&ElementName=" + ["溫度", "3小時降雨機率", "天氣現象"].map(encodeURIComponent).join(",");
  const townships = (data) => data.records && data.records.Locations && data.records.Locations[0] &&
    data.records.Locations[0].Location;
  // Just this township (~15 KB); the whole county only if CWA doesn't know the name.
  let data = await getJSON(url + "&LocationName=" + encodeURIComponent(town));
  let locs = townships(data);
  if (locs && !locs.length) { data = await getJSON(url); locs = townships(data); }
  if (!locs || !locs.length) throw new Error("CWA forecast: " + (data.message || "bad response"));
  let place = locs.find((l) => l.LocationName === town);
  if (!place) {
    place = locs.reduce((best, l) => {
      const d = distanceKm(loc, { latitude: num(l.Latitude), longitude: num(l.Longitude) });
      return !best || d < best.d ? { l, d } : best;
    }, null).l;
  }
  const series = {};
  for (const el of place.WeatherElement) {
    const hourly = cwaElementHourly(el);
    for (const [k, v] of Object.entries(hourly)) {
      series[k] = series[k] || {};
      if (el.ElementName === "溫度") series[k].t = num(v);
      else if (el.ElementName === "3小時降雨機率") series[k].pop = num(v);
      else if (el.ElementName === "天氣現象") series[k].wx = v;
    }
  }
  return { town: place.LocationName, series };
}

async function fetchModels(loc) {
  const names = Object.keys(CONFIG.models);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude.toFixed(4) +
    "&longitude=" + loc.longitude.toFixed(4) +
    "&hourly=temperature_2m,precipitation_probability,precipitation" +
    "&models=" + names.join(",") + "&forecast_days=3&past_days=1&timezone=Asia%2FTaipei";
  const data = await getJSON(url);
  if (!data.hourly) throw new Error("Open-Meteo: " + (data.reason || "bad response"));
  const h = data.hourly;
  const out = {};
  for (const m of names) {
    const series = {};
    const T = h["temperature_2m_" + m] || [];
    const P = h["precipitation_probability_" + m] || [];
    const R = h["precipitation_" + m] || [];
    h.time.forEach((time, i) => {
      if (T[i] == null) return;
      series[time.slice(0, 13)] = { t: T[i], pop: P[i] ?? null, rain: R[i] ?? null };
    });
    if (Object.keys(series).length) out[m] = series;
  }
  return out;
}

// ---------------------------------------------------------------------------
// More for the app view: warnings (widgets show them too), ten days, details, air, radar
// ---------------------------------------------------------------------------
// Active CWA weather warnings (天氣特報) for a county, e.g. { title: "陸上強風特報", until: "2026-10-09 23:00:00" }.
async function fetchWarnings(key, county) {
  const data = await getJSON(CWA_BASE + "W-C0033-001?Authorization=" + encodeURIComponent(key) +
    "&locationName=" + encodeURIComponent(county));
  const loc = data.records && data.records.location && data.records.location[0];
  if (!loc) throw new Error("CWA warnings: " + (data.message || "bad response"));
  return stillActive(((loc.hazardConditions && loc.hazardConditions.hazards) || [])
    .map((h) => ({ title: h.info.phenomena + h.info.significance, until: h.validTime && h.validTime.endTime })));
}
const warningEnd = (w) => Date.parse(String(w.until).replace(" ", "T") + "+08:00"); // CWA gives Taiwan time
const stillActive = (warnings) => (warnings || []).filter((w) => !(warningEnd(w) <= Date.now())); // keeps unparsable

// CWA's 1-week township forecast folded into days: { "YYYY-MM-DD": { hi, lo, pop, wx, uv } }. Each 12-hour
// period counts for the day it starts in, as in CWA's own app; the icon comes from the daytime period.
async function fetchWeek(key, county, town) {
  const id = String(Number(COUNTY_DATASET[county]) + 2).padStart(3, "0"); // each 1-week set follows its 3-day set
  const data = await getJSON(CWA_BASE + "F-D0047-" + id + "?Authorization=" + encodeURIComponent(key) +
    "&LocationName=" + encodeURIComponent(town) +
    "&ElementName=" + ["最高溫度", "最低溫度", "12小時降雨機率", "天氣現象", "紫外線指數"].map(encodeURIComponent).join(","));
  const place = data.records && data.records.Locations && data.records.Locations[0] &&
    data.records.Locations[0].Location[0];
  if (!place) throw new Error("CWA week: " + (data.message || "no forecast for " + town));
  const pick = (f) => (a, b) => (a == null ? b : b == null ? a : f(a, b));
  const max = pick(Math.max), min = pick(Math.min);
  const days = {};
  for (const el of place.WeatherElement) {
    for (const t of el.Time) {
      const start = hourKey(new Date(t.StartTime)), day = start.slice(0, 10);
      const d = days[day] = days[day] || {};
      const v = (t.ElementValue || [])[0] || {};
      if (el.ElementName === "最高溫度") d.hi = max(d.hi, num(v.MaxTemperature));
      else if (el.ElementName === "最低溫度") d.lo = min(d.lo, num(v.MinTemperature));
      else if (el.ElementName === "12小時降雨機率") d.pop = max(d.pop, num(v.ProbabilityOfPrecipitation));
      else if (el.ElementName === "紫外線指數") d.uv = max(d.uv, num(v.UVIndex));
      else if (el.ElementName === "天氣現象" && (!d.wx || start.endsWith("T06"))) d.wx = v.Weather;
    }
  }
  return days;
}

// Open-Meteo's best-match forecast for what the blend doesn't cover: now, ten days, UV, wind, pressure.
async function fetchExtras(loc) {
  const data = await getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude.toFixed(4) +
    "&longitude=" + loc.longitude.toFixed(4) + "&timezone=Asia%2FTaipei&wind_speed_unit=ms&forecast_days=10" +
    "&current=apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m," +
    "pressure_msl,visibility,uv_index&hourly=pressure_msl,wind_gusts_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max");
  if (!data.daily || !data.current || !data.hourly) throw new Error("Open-Meteo extras: " + (data.reason || "bad response"));
  const d = data.daily, h = data.hourly;
  return {
    now: data.current,
    hourly: Object.fromEntries(h.time.map((time, i) =>
      [time.slice(0, 13), { pressure: h.pressure_msl[i], gust: h.wind_gusts_10m[i] }])),
    days: Object.fromEntries(d.time.map((day, i) => [day, { code: d.weather_code[i], hi: d.temperature_2m_max[i],
      lo: d.temperature_2m_min[i], pop: d.precipitation_probability_max[i], uv: d.uv_index_max[i] }])),
  };
}

// Air quality from Open-Meteo (CAMS model, US AQI scale; Taiwan's AQI uses the same breakpoints).
async function fetchAir(loc) {
  const data = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" +
    loc.latitude.toFixed(4) + "&longitude=" + loc.longitude.toFixed(4) + "&timezone=Asia%2FTaipei&current=us_aqi,pm2_5,pm10");
  if (!data.current) throw new Error("Open-Meteo air quality: " + (data.reason || "bad response"));
  return { aqi: data.current.us_aqi, pm25: data.current.pm2_5, pm10: data.current.pm10 };
}

// The latest CWA radar composite as a transparent image, with the latitude/longitude box it covers.
async function fetchRadar(key) {
  const data = await getJSON("https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/O-A0058-006?Authorization=" +
    encodeURIComponent(key) + "&format=JSON");
  const ds = data.cwaopendata && data.cwaopendata.dataset;
  if (!ds) throw new Error("CWA radar: " + (data.message || "bad response"));
  const range = (s) => s.split("-").map(Number); // "118.0-124.0"
  const p = ds.datasetInfo.parameterSet, [west, east] = range(p.LongitudeRange), [south, north] = range(p.LatitudeRange);
  return { url: ds.resource.ProductURL, time: ds.DateTime, bounds: [[south, west], [north, east]] };
}

// WMO weather code (Open-Meteo) → a CWA-style phrase, so wxSymbol() can draw it.
function wmoText(code) {
  if (code >= 95) return "雷雨";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "有雪";
  if (code >= 51) return "有雨";
  if (code === 45 || code === 48) return "有霧";
  return ["晴", "晴時多雲", "多雲", "陰"][code] || "多雲";
}

// Ten days for the app view. Today and tomorrow come from the blended hours (today including its earlier
// hours); later days average CWA's 1-week forecast and Open-Meteo, with CWA counting double.
function dailyForecast(r, week, extras) {
  const today = r.rows[0].key.slice(0, 10), tomorrow = addHours(today + "T00", 24).slice(0, 10);
  const omDays = (extras && extras.days) || {};
  const avg = (a, b) => (a == null ? b : b == null ? a : (2 * a + b) / 3);
  const dates = [...new Set([today, tomorrow, ...Object.keys(week || {}), ...Object.keys(omDays)])]
    .filter((d) => d >= today).sort().slice(0, 10);
  return dates.map((day) => {
    const cwa = (week || {})[day] || {}, om = omDays[day] || {};
    const d = { day, wx: cwa.wx || (om.code != null ? wmoText(om.code) : null), uv: cwa.uv ?? om.uv ?? null,
      hi: avg(cwa.hi, om.hi), lo: avg(cwa.lo, om.lo), pop: avg(cwa.pop, om.pop) };
    if (day === today) {
      const pops = r.rows.filter((h) => h.key.startsWith(today) && h.pop != null).map((h) => h.pop);
      Object.assign(d, { hi: r.summary.hi, lo: r.summary.lo, pop: pops.length ? Math.max(...pops) : d.pop });
      d.wx = d.wx || r.rows[0].wx;
    } else if (day === tomorrow && r.summary.tomorrow && r.summary.tomorrow.hi != null) {
      Object.assign(d, { hi: r.summary.tomorrow.hi, lo: r.summary.tomorrow.lo, pop: r.summary.tomorrow.pop ?? d.pop });
    }
    return d;
  }).filter((d) => d.hi != null && d.lo != null);
}

// Conditions now for the detail tiles: the station's readings where it has them, else Open-Meteo's.
function currentDetails(temp, station, extras, nowKey) {
  const om = (extras && extras.now) || {}, s = station || {};
  const rh = s.rh ?? om.relative_humidity_2m ?? null, wind = s.wind ?? om.wind_speed_10m ?? null;
  const pressure = om.pressure_msl ?? null, before = extras && extras.hourly[addHours(nowKey, -3)];
  return {
    feels: temp != null && rh != null && wind != null ? feelsLike(temp, rh, wind) : om.apparent_temperature ?? null,
    rh, dew: temp != null && rh ? dewPoint(temp, rh) : null,
    wind, windDir: s.windDir ?? om.wind_direction_10m ?? null, gust: s.gust ?? om.wind_gusts_10m ?? null,
    pressure, pressureChange: pressure != null && before && before.pressure != null ? pressure - before.pressure : null,
    visibility: om.visibility ?? null, uv: om.uv_index ?? null,
  };
}

// ---------------------------------------------------------------------------
// Learning: record forecasts, verify, derive per-source bias & weight
// ---------------------------------------------------------------------------
function recordForecasts(state, sources, nowKey) {
  for (const [src, series] of Object.entries(sources)) {
    for (const [k, v] of Object.entries(series)) {
      const lead = (keyToDate(k) - keyToDate(nowKey)) / HOUR;
      const b = leadBucket(lead);
      if (b < 0 || v.t == null) continue;
      state.forecasts[k] = state.forecasts[k] || {};
      state.forecasts[k][src] = state.forecasts[k][src] || {};
      // keep the latest forecast issued within each lead bucket
      state.forecasts[k][src][b] = { t: Math.round(v.t * 10) / 10, pop: v.pop ?? null };
    }
  }
}

function recordObservation(state, station) {
  if (!station || !station.time) return;
  const k = hourKey(new Date(station.time));
  state.obs[k] = { t: station.t, acc: station.acc, station: station.id };
}

// Rain (mm) in the hour ending at k, from the station's running daily total. CWA's day runs to 24:00:
// the 00:00 reading still holds the previous day's total, and the 01:00 reading starts the new day.
function hourlyRain(state, k) {
  const o = state.obs[k];
  if (!o || o.acc == null) return null;
  if (o.acc === DRY_6H) return 0;
  if (k.endsWith("T01")) return o.acc;
  const p = state.obs[addHours(k, -1)];
  if (!p || p.acc == null || p.station !== o.station) return null;
  // Dry for 6 h until last hour, so (unless it also rained earlier today) today's total fell this hour.
  if (p.acc === DRY_6H) return o.acc;
  return o.acc >= p.acc ? o.acc - p.acc : null; // a drop within the day is a correction: unknown
}

function computeSkill(state) {
  // skill[src][bucket] = { n, bias, mae, brierN, brier }
  const skill = {};
  for (const [k, bySrc] of Object.entries(state.forecasts)) {
    const o = state.obs[k];
    if (!o || o.t == null) continue;
    const rain = hourlyRain(state, k);
    for (const [src, byBucket] of Object.entries(bySrc)) {
      for (const [b, f] of Object.entries(byBucket)) {
        const s = ((skill[src] = skill[src] || {})[b] = skill[src][b] ||
          { n: 0, errSum: 0, absSum: 0, brierN: 0, brierSum: 0 });
        const err = f.t - o.t;
        s.n++; s.errSum += err; s.absSum += Math.abs(err);
        if (f.pop != null && rain != null) {
          s.brierN++; s.brierSum += (f.pop / 100 - (rain >= 0.5 ? 1 : 0)) ** 2;
        }
      }
    }
  }
  for (const src of Object.keys(skill)) {
    for (const s of Object.values(skill[src])) {
      s.bias = s.errSum / s.n;
      s.mae = s.absSum / s.n;
      s.brier = s.brierN ? s.brierSum / s.brierN : null;
    }
  }
  return skill;
}

function sourceParams(skill, src, bucket) {
  const prior = src === "cwa" ? CONFIG.cwaPriorMae : CONFIG.models[src] || 2;
  const k = CONFIG.priorStrength;
  const s = skill[src] && skill[src][bucket];
  const n = s ? s.n : 0;
  // shrink learned stats toward priors when samples are few
  const mae = (n * (s ? s.mae : 0) + k * prior) / (n + k);
  const bias = n ? (n * s.bias) / (n + k) : 0;
  const brier = s && s.brier != null
    ? (s.brierN * s.brier + k * 0.15) / (s.brierN + k)
    : 0.15;
  return { weight: 1 / (mae * mae), bias, mae, n,
    popWeight: (src === "cwa" ? 2 : 1) / brier };
}

function pruneState(state, nowKey) {
  const cutoff = addHours(nowKey, -24 * CONFIG.historyDays);
  for (const k of Object.keys(state.forecasts)) if (k < cutoff) delete state.forecasts[k];
  for (const k of Object.keys(state.obs)) if (k < cutoff) delete state.obs[k];
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------
function blend(sources, skill, nowKey, station) {
  const hours = [];
  for (let h = 0; h < 48; h++) hours.push(addHours(nowKey, h));
  const rows = hours.map((k, lead) => {
    const b = leadBucket(lead);
    let tw = 0, tSum = 0, pw = 0, pSum = 0, rainSum = 0, rainN = 0;
    const members = [];
    for (const [src, series] of Object.entries(sources)) {
      const v = series[k];
      if (!v) continue;
      const p = sourceParams(skill, src, b);
      if (v.t != null) {
        const corrected = v.t - p.bias;
        tw += p.weight; tSum += p.weight * corrected;
        members.push(corrected);
      }
      if (v.pop != null) { pw += p.popWeight; pSum += p.popWeight * v.pop; }
      if (v.rain != null) { rainSum += v.rain; rainN++; }
    }
    const t = tw ? tSum / tw : null;
    const spread = members.length > 1
      ? Math.sqrt(members.reduce((a, x) => a + (x - t) ** 2, 0) / members.length) : null;
    return { key: k, lead, t, pop: pw ? pSum / pw : null, rain: rainN ? rainSum / rainN : null,
      spread, wx: sources.cwa && sources.cwa[k] && sources.cwa[k].wx };
  });

  // Nowcast: nudge the first hours toward the live station reading.
  if (station && station.t != null) {
    const obsKey = hourKey(new Date(station.time));
    const ref = rows.find((r) => r.key === obsKey) || rows[0];
    if (ref.t != null) {
      const delta = station.t - ref.t;
      for (const r of rows) {
        if (r.t != null) r.t += delta * Math.exp(-r.lead / CONFIG.nowcastDecayHours);
      }
    }
    // Currently raining at the station → next hours are very likely wet.
    const rainingNow = (station.weather && station.weather.includes("雨"));
    if (rainingNow) {
      for (const r of rows.slice(0, 2)) if (r.pop != null) r.pop = Math.max(r.pop, 80);
    }
  }
  return rows;
}

function summarize(rows, sources, station) {
  const nowKey = rows[0].key, today = nowKey.slice(0, 10);
  const temps = rows.filter((r) => r.key.startsWith(today) && r.t != null).map((r) => r.t);
  // Earlier today: the station's observed extremes, else the sources' mean for each past hour.
  // (The 00:00 reading's daily values still describe yesterday: CWA's day runs to 24:00.)
  const obsKey = station && station.time ? hourKey(new Date(station.time)) : "";
  if (obsKey.startsWith(today) && !obsKey.endsWith("T00") && station.hi != null && station.lo != null) {
    temps.push(station.hi, station.lo);
  } else {
    for (let k = today + "T00"; k < nowKey; k = addHours(k, 1)) {
      const ts = Object.values(sources).map((s) => s[k] && s[k].t).filter((t) => t != null);
      if (ts.length) temps.push(ts.reduce((a, b) => a + b, 0) / ts.length);
    }
  }
  const tomorrowKey = addHours(today + "T00", 24).slice(0, 10);
  const tmr = rows.filter((r) => r.key.startsWith(tomorrowKey));
  const tmrT = tmr.filter((r) => r.t != null).map((r) => r.t);
  const tmrPop = tmr.filter((r) => r.pop != null).map((r) => r.pop);
  const nextRain = rows.slice(0, 24).find((r) => r.pop != null && r.pop >= 50);
  return {
    hi: temps.length ? Math.max(...temps) : null,
    lo: temps.length ? Math.min(...temps) : null,
    nextRain: nextRain ? nextRain.key : null,
    nextRainPop: nextRain ? nextRain.pop : null,
    tomorrow: {
      hi: tmrT.length ? Math.max(...tmrT) : null,
      lo: tmrT.length ? Math.min(...tmrT) : null,
      pop: tmrPop.length ? Math.max(...tmrPop) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function run(apiKey) {
  const store = storage();
  const state = (await store.load()) || emptyState();
  const loc = await getLocation(state);
  state.lastLocation = loc;
  const nowKey = hourKey(new Date());
  const errors = [];
  const settled = (res, fallback = null) => {
    if (res.status === "fulfilled") return res.value;
    errors.push(res.reason.message);
    return fallback;
  };

  // The app view also shows ten days, details, air quality and radar; widgets skip those downloads.
  const forApp = config.runsInApp ? Promise.allSettled([fetchExtras(loc), fetchAir(loc),
    apiKey ? fetchRadar(apiKey) : Promise.resolve(null)]) : null;
  const [stationsRes, modelsRes, townRes] = await Promise.allSettled([
    apiKey ? getStations(apiKey, state, loc) : Promise.reject(new Error("No CWA key")),
    fetchModels(loc),
    findTown(loc, state),
  ]);

  const sources = {};
  let station = null, town = null, warnings = [], week = null;
  if (modelsRes.status === "fulfilled") Object.assign(sources, modelsRes.value);
  else errors.push(modelsRes.reason.message);

  // In Taiwan = a CWA station within reach (stations cover the mountains too); without a key, a township centre.
  const place = townRes.value;
  const stations = stationsRes.status === "fulfilled" ? stationsRes.value : [];
  const inTaiwan = stations.length
    ? stations.some((s) => s.latitude != null && distanceKm(loc, s) <= CONFIG.maxStationKm)
    : place.distance <= CONFIG.maxStationKm;
  if (inTaiwan) town = place.county + place.name;
  if (stationsRes.status === "fulfilled") {
    station = nearestStation(stations, loc);
    if (station && station.distance > CONFIG.maxStationKm) station = null;
    // Outside Taiwan: no station correction and no CWA township forecast or warnings, only the models.
    if (inTaiwan) {
      const [cwaRes, warnRes, weekRes] = await Promise.allSettled([
        fetchCWAForecast(apiKey, place.county, place.name, loc),
        fetchWarnings(apiKey, place.county),
        forApp ? fetchWeek(apiKey, place.county, place.name) : Promise.resolve(null),
      ]);
      const cwa = settled(cwaRes);
      if (cwa) { sources.cwa = cwa.series; town = place.county + cwa.town; }
      warnings = settled(warnRes, []);
      week = settled(weekRes);
    }
  } else errors.push(stationsRes.reason.message);

  if (!Object.keys(sources).length) {
    // Show the last good forecast from the current hour on, if it still reaches that far.
    const rows = state.lastResult ? state.lastResult.rows.filter((r) => r.key >= nowKey) : [];
    if (rows.length) {
      return { ...state.lastResult, rows, station: null, stale: true, errors, warnings: stillActive(state.lastResult.warnings) };
    }
    throw new Error(errors.join("; "));
  }

  recordObservation(state, station);
  recordForecasts(state, sources, nowKey);
  pruneState(state, nowKey);
  const skill = computeSkill(state);
  const rows = blend(sources, skill, nowKey, station);
  for (const r of rows) r.night = isNight(r.key, loc);

  const result = {
    updated: new Date().toISOString(),
    place: town || `${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)}`,
    placeVia: town ? place.via : null,
    station: station && { name: station.name, t: station.t, weather: station.weather,
      distance: station.distance, time: station.time },
    rows: rows.slice(0, 48),
    summary: summarize(rows, sources, station),
    skill: Object.fromEntries(Object.keys(sources).map((src) => [src,
      LEAD_BUCKETS.map((_, b) => sourceParams(skill, src, b))])),
    sources: Object.keys(sources),
    warnings,
    errors,
  };
  if (forApp) {
    const [extras, air, radar] = (await forApp).map((res) => settled(res));
    const today = nowKey.slice(0, 10), tomorrow = addHours(today + "T00", 24).slice(0, 10);
    Object.assign(result, {
      loc, air, radar,
      days: dailyForecast(result, week, extras),
      details: currentDetails(station && station.t != null ? station.t : rows[0].t, station, extras, nowKey),
      rainToday: station && station.acc != null && station.acc >= 0 ? station.acc : null,
      rainNext24: rows.slice(0, 24).reduce((sum, h) => sum + (h.rain || 0), 0),
      gustMax: extras ? Math.max(0, ...rows.slice(0, 24).map((h) => (extras.hourly[h.key] || {}).gust || 0)) : null,
      sun: [today, tomorrow].map((day) => ({ day, ...sunTimes(day, loc) })),
      moon: moonPhase(new Date()),
    });
  }
  state.lastResult = result;
  store.save(state);
  return result;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const C = {
  bgTop: new Color("#1d3b6e"), bgBottom: new Color("#0f1f3d"),
  text: Color.white(), dim: new Color("#ffffff", 0.65), rain: new Color("#7cc4ff"), warn: new Color("#ffd166"),
};
const fmtT = (t) => (t == null ? "–" : Math.round(t) + "°");
const fmtHour = (k) => k.slice(11, 13);

function wxSymbol(wx, pop, night) {
  const s = wx || "";
  if (s.includes("雷")) return "cloud.bolt.rain.fill";
  if (s.includes("雪") || s.includes("冰")) return "cloud.snow.fill";
  if (s.includes("雨") || (pop != null && pop >= 60)) return "cloud.rain.fill";
  if (s.includes("霧")) return "cloud.fog.fill";
  if (s.includes("陰")) return "cloud.fill";
  if (s.includes("雲")) return night ? "cloud.moon.fill" : "cloud.sun.fill";
  if (s.includes("晴")) return night ? "moon.stars.fill" : "sun.max.fill";
  if (pop != null && pop >= 30) return "cloud.drizzle.fill";
  return night ? "cloud.moon.fill" : "cloud.sun.fill";
}

function addSymbol(stack, name, size, color) {
  const sym = SFSymbol.named(name) || SFSymbol.named("cloud.fill");
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color || C.text;
  return img;
}

function addText(stack, str, size, opts = {}) {
  const t = stack.addText(str);
  t.font = opts.bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = opts.color || C.text;
  t.lineLimit = 1;
  if (opts.minScale) t.minimumScaleFactor = opts.minScale;
  return t;
}

function nowText(r) {
  const s = r.summary;
  if (s.nextRain) {
    if (keyToDate(s.nextRain) <= Date.now()) return `Rain now ${Math.round(s.nextRainPop)}%`; // that hour has begun
    const day = s.nextRain.slice(0, 10) === hourKey(new Date()).slice(0, 10) ? "" : "tmrw ";
    return `Rain ${day}~${fmtHour(s.nextRain)}:00 (${Math.round(s.nextRainPop)}%)`;
  }
  return "No rain next 24h";
}

// One column per hour: rows[first], rows[first + step], ... (n columns).
function addHourRow(w, rows, first, n, step) {
  const row = w.addStack();
  for (let c = 0, i = first; c < n; c++, i += step) {
    const h = rows[i];
    if (!h) break;
    const col = row.addStack(); col.layoutVertically(); col.centerAlignContent();
    addText(col, fmtHour(h.key), 10, { color: C.dim });
    addSymbol(col, wxSymbol(h.wx, h.pop, h.night), 14);
    addText(col, fmtT(h.t), 12, { bold: true });
    addText(col, h.pop == null ? "" : Math.round(h.pop) + "%", 9, { color: C.rain });
    row.addSpacer();
  }
}

// A full-width line whose content sits at the right edge.
function rightAligned(stack) {
  const line = stack.addStack();
  line.addSpacer();
  return line;
}

function buildWidget(r, family) {
  const w = new ListWidget();
  const cur = r.station && r.station.t != null ? r.station.t : r.rows[0].t;
  const wx = (r.station && r.station.weather) || r.rows[0].wx;
  const symbol = wxSymbol(wx, r.rows[0].pop, r.rows[0].night);
  const hiLo = `H${fmtT(r.summary.hi)} L${fmtT(r.summary.lo)}`;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60e3);

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
    addSymbol(s, symbol, 14);
    addText(s, fmtT(cur), 16, { bold: true });
    return w;
  }
  if (family === "accessoryInline") {
    addText(w, `${fmtT(cur)} ${nowText(r)}`, 12);
    return w;
  }
  // Active CWA warnings; small widgets name the first and count the rest ("⚠︎ 豪雨特報 +1").
  const titles = (r.warnings || []).map((x) => x.title), compact = family === "small" || family.startsWith("accessory");
  const warning = !titles.length ? null
    : "⚠︎ " + (compact && titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles.join(" · "));
  if (family === "accessoryRectangular") {
    addText(w, `${fmtT(cur)}  ${hiLo}`, 15, { bold: true });
    addText(w, nowText(r), 12);
    addText(w, warning || r.place, 11, { minScale: 0.7 });
    return w;
  }

  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom]; g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(10, 14, 10, 14);

  const top = w.addStack(); top.centerAlignContent();
  const left = top.addStack(); left.layoutVertically();
  addText(left, r.place, 12, { color: C.dim, minScale: 0.6 });
  addText(left, fmtT(cur), family === "large" ? 40 : 36, { bold: true });

  if (family === "small") {
    top.addSpacer();
    addSymbol(top, symbol, 26);
    if (wx) addText(w, wx, 12, { color: C.dim, minScale: 0.7 }); // CWA phrases run up to 11 characters
    addText(w, hiLo, 12, { color: C.dim });
    addText(w, nowText(r), 12, { color: C.rain, minScale: 0.7 });
  } else {
    // Medium and up: condition, high/low and rain go right of the temperature, so the hours fit below.
    // No spacer before this column: it takes all the free width (its lines push content right).
    const right = top.addStack(); right.layoutVertically();
    addSymbol(rightAligned(right), symbol, 24);
    addText(rightAligned(right), `${wx || ""}  ${hiLo}`, 12, { color: C.dim, minScale: 0.7 });
    addText(rightAligned(right), nowText(r), 12, { color: C.rain, minScale: 0.7 });
    w.addSpacer(6);
    if (family === "large") {
      addHourRow(w, r.rows, 1, 12, 1);
      w.addSpacer(8);
      addHourRow(w, r.rows, 13, 12, 1);
      const t = r.summary.tomorrow;
      if (t) {
        w.addSpacer(8);
        addText(w, `Tomorrow  H${fmtT(t.hi)} L${fmtT(t.lo)}  ·  Rain ${t.pop == null ? "–" : Math.round(t.pop) + "%"}`,
          12, { color: C.dim, minScale: 0.7 });
      }
    } else {
      addHourRow(w, r.rows, 1, CONFIG.hoursShown, 2);
    }
  }
  w.addSpacer();
  const time = new Date(r.updated).toTimeString().slice(0, 5);
  if (warning) addText(w, `${r.stale ? "stale · " : ""}${warning} · ${time}`, 9, { color: C.warn, minScale: 0.7 });
  else {
    addText(w, `${r.stale ? "⚠︎ stale · " : ""}${time}` +
      (r.station ? ` · ${r.station.name} ${r.station.distance.toFixed(1)}km` : ""), 9, { color: C.dim, minScale: 0.8 });
  }
  return w;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const EMOJI = { "sun.max.fill": "☀️", "moon.stars.fill": "🌙", "cloud.sun.fill": "⛅", "cloud.moon.fill": "☁️",
  "cloud.fill": "☁️", "cloud.rain.fill": "🌧️", "cloud.drizzle.fill": "🌦️", "cloud.bolt.rain.fill": "⛈️",
  "cloud.fog.fill": "🌫️", "cloud.snow.fill": "🌨️" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AQI_LEVELS = [[50, "Good", "#4cd964"], [100, "Moderate", "#ffcc00"], [150, "Unhealthy for sensitive groups", "#ff9500"],
  [200, "Unhealthy", "#ff3b30"], [300, "Very unhealthy", "#af52de"], [Infinity, "Hazardous", "#8e1b3a"]];
const UV_LEVELS = [[2, "Low"], [5, "Moderate"], [7, "High"], [10, "Very high"], [Infinity, "Extreme"]];
const levelOf = (levels, v) => levels.find(([max]) => v <= max);
const hm = (minutes) => {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
// Colour for a temperature on the ten-day bars: blue (cold) → green → yellow → orange → red (hot).
function tempColor(t) {
  const stops = [[5, [90, 200, 250]], [15, [76, 217, 100]], [22, [255, 204, 0]], [28, [255, 149, 0]], [34, [255, 59, 48]]];
  const i = stops.findIndex(([at]) => t < at);
  if (i === 0) return `rgb(${stops[0][1]})`;
  if (i < 0) return `rgb(${stops[stops.length - 1][1]})`;
  const [[a, ca], [b, cb]] = [stops[i - 1], stops[i]], f = (t - a) / (b - a);
  return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * f))})`;
}
// One sentence for the top of the hourly card, like the Weather app's.
function outlook(r) {
  const s = r.summary;
  let text = "No rain expected in the next 24 hours.";
  if (s.nextRain) {
    const pop = Math.round(s.nextRainPop) + "%";
    const day = s.nextRain.slice(0, 10) === hourKey(new Date()).slice(0, 10) ? "" : "tomorrow ";
    text = keyToDate(s.nextRain) <= Date.now() ? `Rain now (${pop}).` : `Rain likely ${day}around ${fmtHour(s.nextRain)}:00 (${pop}).`;
  }
  if (r.gustMax >= 10.8) text += ` Wind gusts up to ${Math.round(r.gustMax)} m/s.`; // Beaufort 6 and up
  return text;
}

// The app view: what opens when you tap a widget or run the script in Scriptable.
function detailHTML(r) {
  const now = r.rows[0], cur = r.station && r.station.t != null ? r.station.t : now.t;
  const wx = (r.station && r.station.weather) || now.wx || "";
  const symbol = wxSymbol(wx, now.pop, now.night);
  const sky = (/bolt|rain|drizzle|snow/.test(symbol) ? "rain" : /fog|cloud\.fill/.test(symbol) ? "cloudy" : "clear") +
    (now.night ? "-night" : "-day");
  const twNow = new Date(Date.now() + 8 * HOUR), today = twNow.toISOString().slice(0, 10);
  const minuteNow = twNow.getUTCHours() * 60 + twNow.getUTCMinutes();
  const d = r.details || {};
  const card = (title, body, cls = "") => `<section class="card ${cls}">${title ? `<h2>${title}</h2>` : ""}${body}</section>`;
  const tile = (title, big, note) => `<section class="tile"><h3>${title}</h3><p class="big">${big}</p><p>${note}</p></section>`;

  // Hourly strip, with sunrise and sunset slotted in where they fall.
  const events = (r.sun || []).flatMap((s) => [[s.day, s.rise, "🌅", "Sunrise"], [s.day, s.set, "🌇", "Sunset"]]);
  const hours = r.rows.slice(0, 25).flatMap((h, i) => {
    const day = h.key.slice(0, 10), hour = Number(fmtHour(h.key));
    const sun = events.filter(([on, m]) => on === day && Math.floor(m / 60) === hour && !(on === today && m < minuteNow))
      .map(([, m, e, label]) => `<li class="sun"><span>${hm(m)}</span><b>${e}</b><small></small><span>${label}</span></li>`);
    return [`<li><span>${i ? fmtHour(h.key) : "Now"}</span><b>${EMOJI[i ? wxSymbol(h.wx, h.pop, h.night) : symbol]}</b>` +
      `<small>${h.pop != null && h.pop >= 20 ? Math.round(h.pop) + "%" : ""}</small><span>${fmtT(i ? h.t : cur)}</span></li>`, ...sun];
  }).join("");

  // Ten days, each bar placed on the range of the whole ten days.
  const days = r.days || [];
  const lo = Math.min(...days.map((x) => x.lo)), hi = Math.max(...days.map((x) => x.hi)), span = Math.max(1, hi - lo);
  const pct = (t) => (((Math.min(hi, Math.max(lo, t)) - lo) / span) * 100).toFixed(1);
  const dayRows = days.map((x, i) => {
    const name = i ? WEEKDAYS[new Date(Date.parse(x.day + "T12:00:00+08:00")).getUTCDay()] : "Today";
    const dot = i === 0 && cur != null ? `<em style="left:${pct(cur)}%"></em>` : "";
    return `<li><span>${name}</span><b>${EMOJI[wxSymbol(x.wx, x.pop, false)]}<small>${x.pop >= 20 ? Math.round(x.pop) + "%" : ""}</small></b>` +
      `<span class="lo">${fmtT(x.lo)}</span><span class="bar"><i style="left:${pct(x.lo)}%;right:${(100 - pct(x.hi)).toFixed(1)}%;` +
      `background:linear-gradient(90deg,${tempColor(x.lo)},${tempColor(x.hi)})"></i>${dot}</span><span>${fmtT(x.hi)}</span></li>`;
  }).join("");

  // Detail tiles; each appears only when its data came in.
  const tiles = [];
  if (r.air && r.air.aqi != null) {
    const [, label, color] = levelOf(AQI_LEVELS, r.air.aqi);
    tiles.push(tile("🫁 Air quality", `${Math.round(r.air.aqi)} <small>${label}</small>`,
      `<span class="scale aqi"><em style="left:${Math.min(100, r.air.aqi / 3).toFixed(1)}%;border-color:${color}"></em></span>` +
      (r.air.pm25 != null ? `PM2.5 ${Math.round(r.air.pm25)} µg/m³ · ` : "") + "US AQI, model estimate"));
  }
  if (d.uv != null) {
    const max = days[0] && days[0].uv;
    tiles.push(tile("😎 UV index", `${Math.round(d.uv)} <small>${levelOf(UV_LEVELS, d.uv)[1]}</small>`,
      `<span class="scale uv"><em style="left:${Math.min(100, d.uv * 9)}%"></em></span>` +
      (max != null ? `Today's high: ${Math.round(max)}, ${levelOf(UV_LEVELS, max)[1].toLowerCase()}.` : "")));
  }
  if (r.sun && r.sun.length === 2) {
    const [t0, t1] = r.sun;
    tiles.push(minuteNow < t0.rise ? tile("🌅 Sunrise", hm(t0.rise), `Sunset: ${hm(t0.set)}`)
      : minuteNow > t0.set ? tile("🌅 Sunrise", hm(t1.rise), `Tomorrow · sunset ${hm(t1.set)}`)
      : tile("🌇 Sunset", hm(t0.set), `Sunrise: ${hm(t0.rise)}`));
  }
  if (d.wind != null) {
    const arrow = d.windDir != null ? `<i class="arrow" style="transform:rotate(${Math.round(d.windDir + 180)}deg)">↑</i>` : "";
    tiles.push(tile("🌬️ Wind", `${d.wind.toFixed(1)} <small>m/s · force ${beaufort(d.wind)}</small>`,
      `${arrow}${d.windDir != null ? "From " + compass(d.windDir) : ""}${d.windDir != null && d.gust != null ? " · " : ""}` +
      `${d.gust != null ? "gusts " + d.gust.toFixed(1) + " m/s" : ""}`));
  }
  if (r.rainToday != null || r.rainNext24 != null) {
    tiles.push(tile("💧 Rainfall", `${(r.rainToday || 0).toFixed(1)} <small>mm today</small>`,
      `${(r.rainNext24 || 0).toFixed(1)} mm expected in the next 24 h.`));
  }
  if (d.feels != null && cur != null) {
    const gap = d.feels - cur;
    tiles.push(tile("🌡️ Feels like", fmtT(d.feels), Math.abs(gap) < 1 ? "Similar to the actual temperature."
      : gap > 0 ? "Humidity makes it feel warmer." : "Wind makes it feel cooler."));
  }
  if (d.rh != null) {
    tiles.push(tile("💦 Humidity", `${Math.round(d.rh)}%`, d.dew != null ? `The dew point is ${fmtT(d.dew)} right now.` : ""));
  }
  if (d.visibility != null) {
    const km = d.visibility / 1000;
    tiles.push(tile("👁️ Visibility", `${km >= 10 ? Math.round(km) : km.toFixed(1)} <small>km</small>`,
      km >= 10 ? "Clear." : km >= 4 ? "Haze is reducing visibility." : "Poor visibility."));
  }
  if (d.pressure != null) {
    const c = d.pressureChange, trend = c == null || Math.abs(c) < 0.5 ? "Steady" : c > 0 ? "Rising" : "Falling";
    tiles.push(tile("🧭 Pressure", `${Math.round(d.pressure)} <small>hPa</small>`, `${trend} over the last 3 hours.`));
  }
  if (r.moon) {
    const full = new Date(new Date(r.moon.nextFull).getTime() + 8 * HOUR);
    tiles.push(tile(`${r.moon.emoji} Moon`, r.moon.name,
      `Illumination ${Math.round(r.moon.lit * 100)}% · next full moon ${full.getUTCMonth() + 1}/${full.getUTCDate()}`));
  }

  const radar = r.radar && r.loc ? card("🛰️ Rain radar", `<div id="map"></div><p class="note">CWA radar ` +
    `${esc(String(r.radar.time).slice(11, 16))} · the blue dot is you</p>`) : "";
  const srcNames = { cwa: "CWA 鄉鎮預報" };
  const skillRows = Object.entries(r.skill).map(([src, buckets]) =>
    `<tr><td>${srcNames[src] || src}</td>${buckets.map((p) =>
      `<td>${p.mae.toFixed(2)}° <small>${p.n}${p.n ? `, ${p.bias >= 0 ? "+" : ""}${p.bias.toFixed(1)}` : ""}</small></td>`).join("")}</tr>`).join("");
  const warnings = (r.warnings || []).map((w) =>
    `<p><b>⚠️ ${esc(w.title)}</b> <span>until ${esc(String(w.until).slice(5, 16).replace("-", "/"))}</span></p>`).join("");
  const models = r.sources.filter((s) => s !== "cwa").length;

  return `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${radar ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">` : ""}
<style>
:root { color-scheme: dark; --glass: rgba(10, 20, 40, .28); --line: rgba(255, 255, 255, .16); --dim: rgba(255, 255, 255, .64); }
body { margin: 0; color: #fff; font: 16px/1.35 -apple-system, system-ui, sans-serif; min-height: 100vh;
  background: #2f6fbd; background-attachment: fixed; }
.clear-day { background-image: linear-gradient(#2f6fd0, #5aa9e6); } .cloudy-day { background-image: linear-gradient(#5b7590, #8ea4ba); }
.rain-day { background-image: linear-gradient(#45566b, #73849a); } .clear-night { background-image: linear-gradient(#0a1631, #1f3d72); }
.cloudy-night, .rain-night { background-image: linear-gradient(#121a28, #2c3a51); }
main { max-width: 560px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) 16px 40px; display: grid; gap: 12px; }
.hero { text-align: center; padding: 8px 0 14px; text-shadow: 0 1px 6px rgba(0, 0, 0, .18); }
.hero p { margin: 0; } .place { font-size: 28px; } .via { color: var(--dim); font-size: 12px; min-height: 16px; }
.temp { font-size: 96px; font-weight: 200; line-height: 1; margin: 4px 0 2px 24px !important; }
.cond, .hl { font-size: 19px; } .hl { font-weight: 500; }
.card, .tile { background: var(--glass); border-radius: 16px; padding: 12px 14px; min-width: 0;
  -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
h2, h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); }
.alert { background: rgba(120, 70, 0, .45); } .alert p { margin: 2px 0; } .alert span { color: var(--dim); font-size: 14px; }
.summary { margin: 0 0 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); font-size: 15px; }
.hours { display: flex; gap: 2px; overflow-x: auto; list-style: none; margin: 0; padding: 0; scrollbar-width: none; }
.hours li { flex: 0 0 52px; display: grid; justify-items: center; gap: 4px; font-size: 15px; }
.hours li b { font-size: 24px; line-height: 28px; } .hours small { color: #7cc4ff; font-size: 12px; font-weight: 600; min-height: 14px; }
.hours .sun span:last-child { font-size: 12px; }
.days { list-style: none; margin: 0; padding: 0; }
.days li { display: grid; grid-template-columns: 46px 40px 34px minmax(0, 1fr) 34px; align-items: center; gap: 8px;
  padding: 8px 0; border-top: 1px solid var(--line); font-size: 17px; }
.days li:first-child { border-top: 0; } .days b { display: grid; justify-items: center; font-size: 22px; line-height: 1; }
.days b small { color: #7cc4ff; font-size: 11px; font-weight: 600; } .days .lo { color: var(--dim); text-align: right; }
.bar { position: relative; height: 5px; border-radius: 3px; background: rgba(0, 0, 0, .25); }
.bar i { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.bar em, .scale em { position: absolute; top: 50%; width: 7px; height: 7px; margin: -5.5px 0 0 -5.5px; border-radius: 50%;
  background: #fff; border: 2px solid rgba(0, 0, 0, .35); }
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.tile { display: grid; align-content: start; min-height: 128px; }
.tile p { margin: 0; font-size: 14px; } .tile .big { font-size: 30px; margin-bottom: 6px; }
.tile .big small { font-size: 15px; color: var(--dim); }
.scale { position: relative; display: block; height: 5px; border-radius: 3px; margin: 2px 0 10px; }
.aqi { background: linear-gradient(90deg, #4cd964, #ffcc00 17%, #ff9500 33%, #ff3b30 50%, #af52de 67%, #8e1b3a); }
.uv { background: linear-gradient(90deg, #4cd964, #ffcc00 30%, #ff9500 55%, #ff3b30 75%, #af52de); }
.arrow { display: inline-block; font-style: normal; margin-right: 6px; }
#map { height: 280px; border-radius: 10px; background: #1b2433; }
[class$="-night"] #map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); } /* dark map at night */
.note, footer { color: var(--dim); font-size: 12px; } .note { margin: 8px 0 0; }
details summary { cursor: pointer; font-size: 15px; } details p { font-size: 14px; color: var(--dim); }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
td, th { padding: 4px 2px; border-top: 1px solid var(--line); text-align: left; } td small { color: var(--dim); }
footer { text-align: center; line-height: 1.6; } .err { color: #ffd166; }
</style></head><body class="${sky}"><main>
<header class="hero">
  <p class="place">${esc(r.place)}</p>
  <p class="via">${r.placeVia ? `township from ${esc(r.placeVia)}` : ""}${r.station ? ` · station ${esc(r.station.name)} ${r.station.distance.toFixed(1)} km` : ""}</p>
  <p class="temp">${fmtT(cur)}</p>
  <p class="cond">${esc(wx)}</p>
  <p class="hl">H:${fmtT(r.summary.hi)}  L:${fmtT(r.summary.lo)}</p>
</header>
${r.stale ? card("", `<p>Showing the last forecast. ${esc(r.errors.join("; "))}</p>`, "alert") : ""}
${warnings ? card("", warnings, "alert") : ""}
${card("", `<p class="summary">${outlook(r)}</p><ol class="hours">${hours}</ol>`)}
${days.length ? card(`📅 ${days.length}-day forecast`, `<ol class="days">${dayRows}</ol>`) : ""}
${radar}
${tiles.length ? `<div class="tiles">${tiles.join("")}</div>` : ""}
${card("", `<details><summary>How this forecast is made</summary>
<p>Each hour blends CWA's township forecast with ${models} weather models. The nearest CWA station pulls the next
hours toward what it measures now, and every run checks earlier forecasts against the station, so sources that keep
missing here lose weight. Temperature error (°C) per source, then samples and bias:</p>
<table><tr><th>Source</th><th>0–6 h</th><th>6–24 h</th><th>24–48 h</th></tr>${skillRows}</table></details>`)}
<footer>Updated ${new Date(r.updated).toTimeString().slice(0, 5)} · Data: CWA 中央氣象署, Open-Meteo${radar ? ", map © OpenStreetMap contributors" : ""}
${r.errors.length && !r.stale ? `<br><span class="err">${r.errors.map(esc).join("<br>")}</span>` : ""}</footer>
</main>
${radar ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
const here = [${r.loc.latitude}, ${r.loc.longitude}];
if (window.L) {
  const map = L.map("map", { zoomControl: false }).setView(here, 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", // free for light personal use, with credit
    { maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(map);
  L.imageOverlay(${JSON.stringify(r.radar.url)} + "?t=" + Date.now(), ${JSON.stringify(r.radar.bounds)}, { opacity: 0.8 }).addTo(map);
  L.circleMarker(here, { radius: 6, color: "#fff", weight: 2, fillColor: "#0a84ff", fillOpacity: 1 }).addTo(map);
} else {
  document.getElementById("map").textContent = "The map needs an internet connection.";
}
</script>` : ""}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function askKey(message) {
  const a = new Alert();
  a.title = "CWA API key";
  a.message = message;
  a.addTextField("CWA-XXXXXXXX-...");
  a.addAction("Save");
  a.addCancelAction("Skip");
  if ((await a.present()) === -1) return null;
  const key = a.textFieldValue(0).trim();
  if (key) Keychain.set(KEYCHAIN_KEY, key);
  return key || null;
}

async function ensureKey() {
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (config.runsInWidget) return null;
  return askKey("Paste your 授權碼 from opendata.cwa.gov.tw (會員 → 取得授權碼).");
}

async function main() {
  const family = config.widgetFamily || "medium";
  let result;
  try {
    const key = await ensureKey();
    result = await run(key);
    // CWA answered with an error (most likely a mistyped key): offer to replace the saved key.
    const rejected = key && result.errors.find((e) => e.startsWith("CWA stations:"));
    if (config.runsInApp && rejected) {
      const newKey = await askKey(rejected + "\nPaste a new key, or Skip to keep the current one.");
      if (newKey) result = await run(newKey);
    }
  } catch (e) {
    const w = new ListWidget();
    w.addText("Weather error: " + e.message);
    if (config.runsInWidget) { Script.setWidget(w); return; }
    throw e;
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(buildWidget(result, family));
  } else if (config.runsInApp) {
    const wv = new WebView();
    await wv.loadHTML(detailHTML(result));
    await wv.present(true);
  } else {
    await buildWidget(result, family).presentMedium();
  }
}

// __TEST__ is only defined by test/harness.mjs
if (typeof __TEST__ === "undefined") {
  await main();
  Script.complete();
}
