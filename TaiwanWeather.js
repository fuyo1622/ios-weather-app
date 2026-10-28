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
  abroadTimeout: 10,           // s: Open-Meteo and RainViewer (servers in Germany) can stall from Taiwan; CWA gets 20
  swipeWaitMs: 1000,           // the full view waits this long for a new forecast, then shows the last one saved
  locationWaitMs: 6000,        // GPS fix and Apple's geocoder: after this, the last known place / nearest centre
  refreshMinutes: 10,          // widgets ask iOS for a new forecast this often; the open full view refreshes too
  pageWaitMs: 4000,            // the full view waits at most this long for a page to finish loading
  redrawRetryMs: 2000,         // a redraw that would get in the way (finger on the screen…) is tried again this much later
  rainChance: 20,              // %: an hour from here on counts as a chance of rain (its % shows); 50+ is "likely"
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
  const phase = Math.round((age / month) * 8) % 8, [name, emoji] = MOON_PHASES[phase];
  const toFull = (month / 2 - age + month) % month;
  return { phase, name, emoji, lit: (1 - Math.cos((2 * Math.PI * age) / month)) / 2,
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
// A JSON file in Scriptable's folder on the device (not iCloud: works with iCloud Drive off or full).
function jsonFile(name) {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.documentsDirectory(), "taiwan-weather");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  const file = fm.joinPath(dir, name);
  return {
    async load() {
      try {
        if (!fm.fileExists(file)) return null;
        return JSON.parse(fm.readString(file));
      } catch (e) { return null; }
    },
    save(data) { fm.writeString(file, JSON.stringify(data)); },
  };
}
// Forecast and learning state: one file for My Location, one per saved place, so each learns its own errors.
const storage = (place) => jsonFile(place ? `place-${place.county}${place.name}.json` : "state.json");

// Settings shared by the widgets and the full view.
const DEFAULT_SETTINGS = { lang: "en", places: [], notify: { rain: true, warnings: true } };
async function loadSettings() {
  const s = (await jsonFile("settings.json").load()) || {};
  return { ...DEFAULT_SETTINGS, ...s, places: [...(s.places || [])], notify: { ...DEFAULT_SETTINGS.notify, ...(s.notify || {}) } };
}
const saveSettings = (settings) => jsonFile("settings.json").save(settings);

function emptyState() {
  // forecasts[validHour][source][bucket] = { t, pop }
  // obs[hour] = { t, acc, station }
  // stations = { time, list: [[id, latitude, longitude]] }: CWA station positions, refreshed weekly
  return { version: 1, forecasts: {}, obs: {}, stations: null, lastLocation: null, lastResult: null };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function getJSON(url, timeout = 20) {
  const req = new Request(url);
  req.timeoutInterval = timeout; // seconds without an answer
  return await req.loadJSON();
}

// Downloads that are the same for every place (radar, warnings, the station list), shared by the places shown
// in one full-view session for a few minutes. A failure isn't kept.
const sharedDownloads = new Map();
function shared(name, minutes, download) {
  const hit = sharedDownloads.get(name), age = hit ? Date.now() - hit.at : Infinity;
  if (age >= 0 && age < minutes * 60e3) return hit.promise;
  const promise = download();
  sharedDownloads.set(name, { at: Date.now(), promise });
  promise.catch(() => { if (sharedDownloads.get(name)?.promise === promise) sharedDownloads.delete(name); });
  return promise;
}

// The value of promise if it arrives within ms, else null; the promise keeps going. (Without a timer, it waits.)
function within(promise, ms) {
  return new Promise((done) => {
    let timer = null;
    try { timer = Timer.schedule(ms, false, () => done(null)); } catch (e) { /* no Timer here */ }
    const stop = () => { if (timer) timer.invalidate(); };
    promise.then((v) => { stop(); done(v); }, () => { stop(); done(null); });
  });
}

async function getLocation(state) {
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await within(Location.current(), CONFIG.locationWaitMs); // no fix in time: the last known place
    if (!loc) throw new Error("no location");
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

// Readings of the stations nearest to loc. The full list (~900 stations, ~75 KB gzipped) is fetched once a
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
  const all = await shared("stations " + key, 60, () => fetchStations(key));
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
    const names = ((await within(Location.reverseGeocode(loc.latitude, loc.longitude, "zh_TW"), CONFIG.locationWaitMs)) || [])
      .flatMap((p) => Object.values(p)).filter((v) => typeof v === "string").map((v) => v.replace(/台/g, "臺"));
    match = TOWN_POINTS.find((t) => names.includes(t.county) && names.includes(t.name));
  } catch (e) { /* offline or no answer: use the nearest centre */ }
  const town = match ? { ...match, via: "apple" } : { ...nearestTown(loc), via: "nearest" };
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
  const data = await getJSON(url, CONFIG.abroadTimeout);
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
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
    CONFIG.abroadTimeout);
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
    loc.latitude.toFixed(4) + "&longitude=" + loc.longitude.toFixed(4) + "&timezone=Asia%2FTaipei&current=us_aqi,pm2_5,pm10",
    CONFIG.abroadTimeout);
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

// When each 降雨雷達 image was taken: { "O-A0084-001": "2026-10-09T09:10:00+08:00", … } (three small requests).
async function fetchRainRadarTimes(key) {
  const metas = await Promise.all(RAIN_RADARS.map((s) => getJSON(`https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${s.id}` +
    `?Authorization=${encodeURIComponent(key)}&format=JSON`).catch(() => null)));
  return Object.fromEntries(RAIN_RADARS.map((s, i) => [s.id, metas[i] && metas[i].cwaopendata && metas[i].cwaopendata.dataset &&
    metas[i].cwaopendata.dataset.DateTime]).filter(([, t]) => t));
}

// The 降雨雷達 images of the last 40 minutes, one every 2 minutes, from the list CWA's website animates (open data
// has only the latest): { RCSL: [{ time, path }, …], … }, newest first. Their 1000 px versions (about 230 KB) are
// what the next-hour forecast reads. The list is about 35 KB.
async function fetchRainRadarFrames() {
  const req = new Request(CWA_SITE + "Data/js/obs_img/Observe_radar_rain.js");
  req.timeoutInterval = 10;
  const text = await req.loadString().catch((e) => { throw new Error("CWA rain radar: " + e.message); }), frames = {};
  for (const [path, code, t] of text.matchAll(/CV1_(RC[A-Z]{2})_1000\/CV1_\1_1000_(\d{14})_\w+\.png/g)) {
    const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((i, k) => Number(t.slice(i, k ? i + 2 : 4)));
    const time = Date.UTC(y, mo - 1, d, h - 8, mi, s); // Taiwan time
    if (Date.now() - time < 40 * 60e3) (frames[code] = frames[code] || []).push({ time, path });
  }
  if (!Object.keys(frames).length) throw new Error("CWA rain radar: no recent images");
  for (const list of Object.values(frames)) list.sort((a, b) => b.time - a.time);
  return frames;
}

// Up to three frames about ten minutes apart (within 4 minutes of that, and at least 5 apart), oldest first,
// ending with the newest: what the next-hour forecast follows the rain through. Fewer if the radar skipped some.
function pickFrames(list) {
  if (!list || !list.length) return [];
  const newest = list[0], picked = [newest];
  for (const back of [10, 20]) {
    const want = newest.time - back * 60e3;
    const f = list.reduce((best, x) => (Math.abs(x.time - want) < Math.abs(best.time - want) ? x : best));
    if (Math.abs(f.time - want) <= 4 * 60e3 && f.time <= picked[0].time - 5 * 60e3) picked.unshift(f);
  }
  return picked;
}

// Radar frames from the past two hours, ten minutes apart (RainViewer, which covers Taiwan), for the map's animation.
async function fetchRainViewer() {
  const data = await getJSON("https://api.rainviewer.com/public/weather-maps.json", CONFIG.abroadTimeout);
  const past = data.radar && data.radar.past;
  if (!past || !past.length) throw new Error("RainViewer: no radar frames");
  return { host: data.host, frames: past.map((f) => ({ time: f.time * 1000, path: f.path })) };
}

// RainViewer now serves only its "Universal Blue" colours, whatever scheme is asked for (seen 2026-10-13). These
// are its colours for 15, 16, … 65 dBZ (rainviewer.com/files/rainviewer_api_colors_table.csv). Weaker echoes are
// see-through tan: drizzle, or clutter on a dry day.
const RAINVIEWER_COLORS = "88ddee 6cd1eb 51c5e8 36bae5 1baee2 00a3e0 009ad5 0091ca 0088bf 007fb4 0077aa 0070a3 " +
  "00699c 006295 005b8e 005588 005180 004e78 004a70 004768 ffee00 ffe000 ffd200 ffc500 ffb700 ffaa00 ff9f00 ff9500 " +
  "ff8b00 ff8100 ff4400 f23600 e62800 d91b00 cd0d00 c10000 a80000 8f0000 760000 5d0000 ffaaff ff9fff ff95ff ff8bff " +
  "ff81ff ff77ff ff6cff ff62ff ff58ff ff4eff ffffff";

// dBZ for each pixel of RainViewer tiles (RGBA bytes from a canvas); see-through pixels count as 0. `odd` counts
// opaque pixels in none of its colours, so if RainViewer changes them, the forecast says so instead of guessing.
// Runs in the full view's page (passed in with toString()), so it must not use anything outside itself.
function radarDBZ(px, colors) {
  const table = colors.split(" ").map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const exact = new Map(table.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, 15 + i]));
  const dbz = new Uint8Array(px.length / 4);
  let seen = 0, odd = 0;
  for (let i = 0; i < dbz.length; i++) {
    if (px[i * 4 + 3] < 255) continue; // transparent: no echo; see-through: under 15 dBZ
    seen++;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    let v = exact.get((r << 16) | (g << 8) | b), best = 900;
    if (v == null) { // shifted a little on the way (colour management): the nearest colour, if close
      table.forEach(([tr, tg, tb], k) => {
        const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
        if (d < best) { best = d; v = 15 + k; }
      });
    }
    if (v == null) odd++; else dbz[i] = v;
  }
  return { dbz, seen, odd };
}

// CWA's 降雨雷達 colours for 0, 1, … 65 dBZ: the colour bar on its images (read 2026-10-27). Its images are
// opaque: white sea and light grey land where it sees no echo, shaded where it can't see.
const CWA_RADAR_COLORS = "00ffff 00ecff 00daff 00c8ff 00b6ff 00a3ff 0091ff 007fff 006dff 005bff 0048ff 0036ff " +
  "0024ff 0012ff 0000ff 00ff00 00f400 00e900 00de00 00d300 00c800 00be00 00b400 00aa00 00a000 009600 33ab00 66c000 " +
  "99d500 ccea00 ffff00 fff400 ffe900 ffde00 ffd300 ffc800 ffb800 ffa800 ff9800 ff8800 ff7800 ff6000 ff4800 ff3000 " +
  "ff1800 ff0000 f40000 e90000 de0000 d30000 c80000 be0000 b40000 aa0000 a00000 960000 ab0033 c00066 d50099 ea00cc " +
  "ff00ff ea00ff d500ff c000ff ab00ff 9600ff";

// A size × size grid of dBZ from a square piece of a 降雨雷達 image (RGBA bytes from a canvas, size × block pixels
// a side): each cell the strongest echo among its block × block pixels. `blind` marks cells the radar can't see
// (its shaded sectors behind mountains, beyond its 150 km, or off the image). `odd` counts strongly coloured pixels
// in none of its colours (mostly echoes under a county border); if they outnumber the rest, CWA has changed the
// colours and the forecast says so instead of guessing.
// Runs in the full view's page (passed in with toString()), so it must not use anything outside itself.
function rainRadarGrid(px, colors, size, block) {
  const table = colors.split(" ").map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const exact = new Map(table.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));
  const SHADED = new Set([0xe7ecf1, 0xd2d7dc]); // sea, land
  const side = size * block, dbz = new Uint8Array(size * size), blind = new Uint8Array(size * size);
  let seen = 0, odd = 0;
  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      let most = 0, hidden = 0;
      for (let y = cy * block; y < (cy + 1) * block; y++) {
        for (let x = cx * block; x < (cx + 1) * block; x++) {
          const i = (y * side + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], rgb = (r << 16) | (g << 8) | b;
          if (px[i + 3] < 255 || SHADED.has(rgb)) { hidden++; continue; }
          let v = exact.get(rgb);
          if (v == null) {
            if (Math.max(r, g, b) - Math.min(r, g, b) <= 100) continue; // map, text: no echo
            let best = 900; // shifted a little on the way (colour management): the nearest colour, if close
            table.forEach(([tr, tg, tb], k) => {
              const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
              if (d < best) { best = d; v = k; }
            });
            if (v == null) { odd++; continue; }
          }
          seen++;
          if (v > most) most = v;
        }
      }
      dbz[cy * size + cx] = most;
      blind[cy * size + cx] = hidden * 2 >= block * block ? 1 : 0;
    }
  }
  return { dbz, blind, seen, odd };
}

// Rain for the next hour at the centre of two or three radar grids (size × size dBZ values, oldest first, gaps[i]
// minutes between frame i and i + 1; the newest is ageMin minutes old): find how the rain moved between frames,
// then follow it forward (Lagrangian persistence). Returns rain rates (mm/h) for 0, 5, … 60 minutes from now, and
// the motion found (cells per minute). Cells are 1.1–1.2 km. Echoes from RAIN dBZ on count as rain: for the
// 降雨雷達 15 (0.3 mm/h, drizzle), where its colours turn green; for RainViewer 20 (0.6 mm/h), as before.
// Runs in the full view's page (passed in with toString()), so it must not use anything outside itself.
function nowcastFrom(frames, size, ageMin, gaps = [10, 10], RAIN = 20) {
  const at = (g, x, y) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : g[Math.round(y) * size + Math.round(x)]);
  // the shift carrying grid a onto grid b with the smallest mean difference where either has rain, per minute
  const shift = (a, b, minutes) => {
    const reach = Math.ceil(1.4 * minutes); // cells: up to ~100 km/h
    let best = null;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        let err = 0, n = 0;
        for (let y = reach; y < size - reach; y += 2) {
          for (let x = reach; x < size - reach; x += 2) {
            const va = a[y * size + x], vb = b[(y + dy) * size + x + dx];
            if (va < RAIN && vb < RAIN) continue;
            err += Math.abs(va - vb); n++;
          }
        }
        if (n > 20 && (!best || err / n < best.err)) best = { dx, dy, err: err / n };
      }
    }
    return best && { dx: best.dx / minutes, dy: best.dy / minutes };
  };
  const moves = frames.slice(1).map((g, i) => shift(frames[i], g, gaps[i])).filter(Boolean);
  const v = moves.length ? { dx: moves.reduce((s, m) => s + m.dx, 0) / moves.length, dy: moves.reduce((s, m) => s + m.dy, 0) / moves.length }
    : { dx: 0, dy: 0 };
  const c = size / 2, last = frames[frames.length - 1];
  const steps = [];
  for (let min = 0; min <= 60; min += 5) {
    const back = min + ageMin; // minutes: rain arriving here then is now this far upstream
    const near = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) near.push(at(last, c - v.dx * back + ox, c - v.dy * back + oy));
    const dbz = near.sort((a, b) => b - a)[1]; // the second highest of the 3 × 3: one stray pixel isn't rain
    steps.push({ min, dbz, mmh: dbz >= RAIN ? Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6) : 0 }); // Marshall–Palmer
  }
  return { steps, motion: v, moving: moves.length > 0 };
}

// What the hourly card says once the radar has been read, so it never contradicts the next-hour card: the radar's
// sentence for the coming hour, then the forecast for the hours after it (plan.later, from detailHTML); and for
// each hour the radar decides (this one, and the next when half of it or more falls in the coming hour), whether
// the radar sees rain in it. steps: nowcastFrom()'s.
// Runs in the full view's page (passed in with toString()), so it must not use anything outside itself.
function radarOutlook(plan, sentence, steps) {
  const wet = steps.some((x) => x.mmh > 0);
  const text = wet || plan.later ? [sentence, plan.later].filter(Boolean).join(plan.sep) : plan.none24;
  const hours = Array.from({ length: plan.decided }, (_, i) => {
    const from = i ? 60 - plan.minute : 0, to = i ? 60 : 60 - plan.minute; // minutes from now
    return steps.some((x) => x.mmh > 0 && x.min >= from && x.min <= to);
  });
  return { text: text + plan.gust, hours };
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

// The first of these hours with a chance of rain (20 %+), and the first where rain is likely (50 %+: what rain
// notifications wait for).
function rainSummary(rows) {
  const next = rows.find((h) => h.pop != null && h.pop >= CONFIG.rainChance), likely = rows.find((h) => h.pop != null && h.pop >= 50);
  return { nextRain: next ? next.key : null, nextRainPop: next ? next.pop : null,
    likelyRain: likely ? likely.key : null, likelyRainPop: likely ? likely.pop : null };
}
// Whether the nearest station reports rain right now: the only time a forecast hour may say "Rain now".
const stationRain = (r) => !!(r.station && r.station.weather && r.station.weather.includes("雨"));

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
  return {
    hi: temps.length ? Math.max(...temps) : null,
    lo: temps.length ? Math.min(...temps) : null,
    ...rainSummary(rows.slice(0, 24)),
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
// opts.place: a saved township (an entry of TOWN_POINTS) instead of the phone's location.
// opts.settings: when given for My Location, rain and warning notifications are sent as they apply.
async function run(apiKey, opts = {}) {
  const pinned = opts.place || null;
  const store = storage(pinned);
  const state = (await store.load()) || emptyState();
  const loc = pinned ? { latitude: pinned.latitude, longitude: pinned.longitude } : await getLocation(state);
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
    apiKey ? shared("radar " + apiKey, 5, () => fetchRadar(apiKey)) : Promise.resolve(null),
    shared("rainviewer", 5, fetchRainViewer),
    apiKey ? shared("rain radars " + apiKey, 2, () => fetchRainRadarTimes(apiKey)) : Promise.resolve({}),
    RAIN_RADARS.some((s) => distanceKm(loc, s) <= 145) ? shared("rain radar frames", 2, fetchRainRadarFrames)
      : Promise.resolve(null)]) : null;
  // Open-Meteo's servers are in Germany and can stall from Taiwan, so CWA's requests don't wait for them.
  const modelsReq = Promise.allSettled([fetchModels(loc)]);
  const [stationsRes, townRes] = await Promise.allSettled([
    apiKey ? getStations(apiKey, state, loc) : Promise.reject(new Error("No CWA key")),
    pinned ? { ...pinned, via: "saved", distance: 0 } : findTown(loc, state),
  ]);

  // In Taiwan = a saved township, or a CWA station within reach (stations cover the mountains too), or without
  // a key, a township centre. Outside Taiwan: no station correction and no CWA township forecast or warnings.
  const place = townRes.value;
  const stations = stationsRes.status === "fulfilled" ? stationsRes.value : [];
  const inTaiwan = pinned ? true : stations.length
    ? stations.some((s) => s.latitude != null && distanceKm(loc, s) <= CONFIG.maxStationKm)
    : place.distance <= CONFIG.maxStationKm;
  const cwaReq = stationsRes.status === "fulfilled" && inTaiwan ? Promise.allSettled([
    fetchCWAForecast(apiKey, place.county, place.name, loc),
    shared("warnings " + place.county, 5, () => fetchWarnings(apiKey, place.county)),
    forApp ? fetchWeek(apiKey, place.county, place.name) : Promise.resolve(null),
  ]) : null;
  const [modelsRes] = await modelsReq;

  const sources = {};
  let station = null, town = null, warnings = [], week = null;
  if (modelsRes.status === "fulfilled") Object.assign(sources, modelsRes.value);
  else errors.push(modelsRes.reason.message);
  if (inTaiwan) town = place.county + place.name;
  if (stationsRes.status === "fulfilled") {
    station = nearestStation(stations, loc);
    if (station && station.distance > CONFIG.maxStationKm) station = null;
    if (cwaReq) {
      const [cwaRes, warnRes, weekRes] = await cwaReq;
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
    pinned: pinned && pinned.county + pinned.name,
    warnings,
    errors,
  };
  if (forApp) {
    const [extras, air, radar, frames, rainRadarTimes, rainFrames] = (await forApp).map((res) => settled(res));
    const today = nowKey.slice(0, 10), tomorrow = addHours(today + "T00", 24).slice(0, 10);
    Object.assign(result, {
      loc, air, radar, frames, rainRadarTimes, rainFrames,
      days: dailyForecast(result, week, extras),
      details: currentDetails(station && station.t != null ? station.t : rows[0].t, station, extras, nowKey),
      rainToday: station && station.acc != null && station.acc >= 0 ? station.acc : null,
      rainNext24: rows.slice(0, 24).reduce((sum, h) => sum + (h.rain || 0), 0),
      gustMax: extras ? Math.max(0, ...rows.slice(0, 24).map((h) => (extras.hourly[h.key] || {}).gust || 0)) : null,
      sun: [today, tomorrow].map((day) => ({ day, ...sunTimes(day, loc) })),
      moon: moonPhase(new Date()),
    });
  }
  if (!pinned && opts.settings) await notifyChanges(state, result, opts.settings);
  state.lastResult = result;
  store.save(state);
  return result;
}

// Local notifications for My Location, each sent once: rain starting within the hour (at most every 3 hours,
// and not while the station already reports rain), and CWA warnings that weren't there on the last run.
async function notifyChanges(state, r, settings) {
  const sent = state.notified = state.notified || { rain: null, warnings: [] };
  const out = [], s = r.summary, now = Date.now();
  if (settings.notify.rain && s.likelyRain) { // 50 % or more
    const soon = keyToDate(s.likelyRain) - now <= HOUR, pop = Math.round(s.likelyRainPop) + "%";
    const recent = sent.rain && now - Date.parse(sent.rain) < 3 * HOUR;
    const raining = r.station && r.station.weather && r.station.weather.includes("雨");
    if (soon && !recent && !raining) {
      const body = keyToDate(s.likelyRain) <= now ? T().rainLikelyNowLong(pop) : T().rainAtLong(false, fmtHour(s.likelyRain) + ":00", pop);
      out.push({ id: "rain", title: T().rainSoonTitle(r.place), body });
      sent.rain = new Date(now).toISOString();
    }
  }
  const ids = (r.warnings || []).map((w) => w.title + "|" + w.until);
  if (settings.notify.warnings) {
    (r.warnings || []).forEach((w, i) => {
      if (!sent.warnings.includes(ids[i])) {
        out.push({ id: "warning-" + w.title, title: `⚠️ ${w.title} · ${r.place}`, body: T().warnBody(shortTime(w.until)) });
      }
    });
  }
  sent.warnings = ids;
  for (const m of out) await sendNotification(m.id, m.title, m.body);
  return out;
}
// A local notification that opens the full view when tapped; false if this context may not send one.
async function sendNotification(id, title, body) {
  try {
    const n = new Notification();
    Object.assign(n, { identifier: "taiwan-weather-" + id, threadIdentifier: "taiwan-weather", title, body,
      openURL: "scriptable:///run/" + encodeURIComponent(Script.name()) });
    await n.schedule();
    return true;
  } catch (e) {
    return false;
  }
}
// "2026-10-09 23:00:00" → "10/09 23:00"
const shortTime = (s) => String(s).slice(5, 16).replace("-", "/");

// ---------------------------------------------------------------------------
// Words: English and 繁體中文. The full view has a switch; widgets follow it.
// ---------------------------------------------------------------------------
const WORDS = {
  en: {
    now: "Now", today: "Today", tomorrow: "Tomorrow", weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    hiLo: (hi, lo) => `H${hi} L${lo}`, hiLoWide: (hi, lo) => `H:${hi}  L:${lo}`,
    rainNowShort: (p) => `Rain now ${p}%`, rainAtShort: (tmrw, t, p) => `Rain ${tmrw ? "tmrw " : ""}~${t} (${p}%)`,
    rainChanceShort: (p) => `Rain chance ${p}%`, rainLikelyNowShort: (p) => `Rain likely ${p}%`,
    noRainShort: "No rain next 24h", tomorrowLine: (hi, lo, pop) => `Tomorrow  H${hi} L${lo}  ·  Rain ${pop}`,
    stale: "stale", weatherError: "Weather error: ",
    unknownPlace: (p) => `Unknown place "${p}". Use a township, e.g. 臺南市東區.`,
    via: { apple: "township from Apple Maps", nearest: "township from the nearest township centre", saved: "saved place" },
    station: (name, km) => `station ${name} ${km} km`, staleBanner: "Showing the last forecast.", until: (t) => `until ${t}`,
    noRain24: "No rain expected in the next 24 hours.", rainNowLong: (p) => `Rain now (${p}).`,
    rainAtLong: (tmrw, t, p) => `Rain likely ${tmrw ? "tomorrow " : ""}around ${t} (${p}).`,
    rainChanceNowLong: (p) => `Chance of rain now (${p}).`, rainLikelyNowLong: (p) => `Rain likely this hour (${p}).`,
    rainChanceAtLong: (tmrw, t, p) => `Chance of rain ${tmrw ? "tomorrow " : ""}around ${t} (${p}).`,
    gusts: (v) => ` Wind gusts up to ${v} m/s.`, sunrise: "Sunrise", sunset: "Sunset", days: (n) => `${n}-day forecast`,
    radar: "Rain radar", radarNote: (src, t) => `${src}${t ? " " + t : ""} · the blue dot is you`, play: "Play", pause: "Pause",
    mapOffline: "The map needs an internet connection.", radarTabs: ["Moving radar", "CWA rain radar"],
    cwaRadarNote: (name, t) => `CWA rain radar at ${name}${t ? " " + t : ""}, every 2 minutes · the blue dot is you`,
    nextHour: "Next hour", nhNone: "No rain in the next hour.", nhStart: "{kind} rain starting in about {min} min.",
    nhStop: "{kind} rain stopping in about {min} min.", nhAll: "{kind} rain for the next hour.",
    nhKinds: ["Light", "Moderate", "Heavy"], nhUnavailable: "The radar isn't available right now.",
    nhFromCWA: (name, t) => `From CWA's ${name} rain radar (${t}): the last 20 minutes, carried forward.`,
    nhFromRV: (t) => `From RainViewer's radar (${t}): the last 20 minutes, carried forward.`, min30: "30 min", min60: "60 min",
    nhAmount: (mm) => `About ${mm} mm in the next hour.`,
    air: "Air quality", aqiLevels: ["Good", "Moderate", "Unhealthy for sensitive groups", "Unhealthy", "Very unhealthy", "Hazardous"],
    aqiNote: (pm) => `${pm != null ? `PM2.5 ${pm} µg/m³ · ` : ""}US AQI, model estimate`,
    uv: "UV index", uvLevels: ["Low", "Moderate", "High", "Very high", "Extreme"],
    uvToday: (v, level) => `Today's high: ${v}, ${level.toLowerCase()}.`,
    sunsetAt: (t) => `Sunset: ${t}`, sunriseAt: (t) => `Sunrise: ${t}`, tomorrowSunset: (t) => `Tomorrow · sunset ${t}`,
    wind: "Wind", windSpeed: (v, force) => `${v} <small>m/s · force ${force}</small>`, from: (dir) => `From ${dir}`,
    gust: (v) => `gusts ${v} m/s`, dirs: {},
    rain: "Rainfall", rainToday: (v) => `${v} <small>mm today</small>`, rainNext: (v) => `${v} mm expected in the next 24 h.`,
    feels: "Feels like", feelsSame: "Similar to the actual temperature.", feelsWarmer: "Humidity makes it feel warmer.",
    feelsCooler: "Wind makes it feel cooler.", humidity: "Humidity", dew: (t) => `The dew point is ${t} right now.`,
    visibility: "Visibility", km: "km", visClear: "Clear.", visHaze: "Haze is reducing visibility.", visPoor: "Poor visibility.",
    pressure: "Pressure", hPa: "hPa", pressureTrend: { steady: "Steady", rising: "Rising", falling: "Falling" },
    pressureNote: (trend) => `${trend} over the last 3 hours.`,
    moon: "Moon", moonNames: ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon",
      "Waning Gibbous", "Last Quarter", "Waning Crescent"],
    moonNote: (lit, md) => `Illumination ${lit}% · next full moon ${md}`,
    howTitle: "How this forecast is made",
    howText: (models) => `Each hour blends CWA's township forecast with ${models} weather models. The nearest CWA
station pulls the next hours toward what it measures now, and every run checks earlier forecasts against the station,
so sources that keep missing here lose weight. Temperature error (°C) per source, then samples and bias:`,
    source: "Source", hours: (a, b) => `${a}–${b} h`,
    footer: (t, map) => `Updated ${t} · Data: CWA 中央氣象署, Open-Meteo${map ? `, map © OpenStreetMap contributors${map === 2 ? ", radar © RainViewer" : ""}` : ""}`,
    here: "My Location", add: "Add", addTitle: "Add a place", search: "Search a township, e.g. 東區", remove: "Remove",
    cancel: "Cancel", settings: "Settings", language: "Language", notifications: "Notifications for My Location",
    notifyRain: "Rain within the hour", notifyWarnings: "New CWA warnings", on: "On", off: "Off", loading: "Loading…",
    updating: (t) => `Updating… (shown: ${t})`,
    timing: (x) => `Last switch: forecast ${(x.forecast / 1000).toFixed(1)} s${x.saved ? " (showed the saved one)" : ""}, page ${(x.page / 1000).toFixed(1)} s`, loadFailed: "Couldn't load the forecast.", tryAgain: "Try again",
    rainSoonTitle: (place) => `🌧️ Rain soon · ${place}`, warnBody: (t) => `Until ${t} · CWA`,
    testButton: "Send a test", testTitle: "🔔 TaiwanWeather",
    testBodyApp: "Notifications work. A widget will send a second test at its next refresh.",
    testBodyWidget: "Notifications from the widget work too.",
    keyTitle: "CWA API key", keyPrompt: "Paste your 授權碼 from opendata.cwa.gov.tw (會員 → 取得授權碼).",
    keyRejected: (e) => `${e}\nPaste a new key, or Skip to keep the current one.`, save: "Save", skip: "Skip",
  },
  zh: {
    now: "現在", today: "今天", tomorrow: "明天", weekdays: ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
    hiLo: (hi, lo) => `高${hi} 低${lo}`, hiLoWide: (hi, lo) => `最高 ${hi}  最低 ${lo}`,
    rainNowShort: (p) => `正在下雨 ${p}%`, rainAtShort: (tmrw, t, p) => `${tmrw ? "明天 " : ""}${t} 可能下雨 ${p}%`,
    rainChanceShort: (p) => `降雨機率 ${p}%`, rainLikelyNowShort: (p) => `可能下雨 ${p}%`,
    noRainShort: "24 小時內無雨", tomorrowLine: (hi, lo, pop) => `明天  高${hi} 低${lo}  ·  降雨 ${pop}`,
    stale: "舊資料", weatherError: "天氣錯誤：",
    unknownPlace: (p) => `找不到「${p}」。請輸入鄉鎮市區，例如 臺南市東區。`,
    via: { apple: "鄉鎮由 Apple 地圖判定", nearest: "鄉鎮依最近的鄉鎮中心", saved: "已儲存的地點" },
    station: (name, km) => `測站 ${name} ${km} 公里`, staleBanner: "顯示上一次的預報。", until: (t) => `至 ${t}`,
    noRain24: "未來 24 小時預計不會下雨。", rainNowLong: (p) => `現在正在下雨（${p}）。`,
    rainAtLong: (tmrw, t, p) => `${tmrw ? "明天 " : ""}${t} 左右可能下雨（${p}）。`,
    rainChanceNowLong: (p) => `現在有機會下雨（${p}）。`, rainLikelyNowLong: (p) => `這一小時可能下雨（${p}）。`,
    rainChanceAtLong: (tmrw, t, p) => `${tmrw ? "明天 " : ""}${t} 左右有機會下雨（${p}）。`,
    gusts: (v) => `陣風最大每秒 ${v} 公尺。`, sunrise: "日出", sunset: "日落", days: (n) => `${n} 天預報`,
    radar: "雷達回波", radarNote: (src, t) => `${src}${t ? " " + t : ""} · 藍點是你的位置`, play: "播放", pause: "暫停",
    mapOffline: "地圖需要網路連線。", radarTabs: ["動態雷達", "降雨雷達"],
    cwaRadarNote: (name, t) => `氣象署降雨雷達（${name}）${t ? " " + t : ""}，每 2 分鐘更新 · 藍點是你的位置`,
    nextHour: "未來一小時", nhNone: "未來一小時不會下雨。", nhStart: "約 {min} 分鐘後開始下{kind}。",
    nhStop: "{kind}約 {min} 分鐘後停。", nhAll: "未來一小時都會下{kind}。",
    nhKinds: ["小雨", "中雨", "大雨"], nhUnavailable: "目前無法取得雷達資料。",
    nhFromCWA: (name, t) => `依氣象署${name}降雨雷達（${t}）過去 20 分鐘的回波推估。`,
    nhFromRV: (t) => `依 RainViewer 雷達（${t}）過去 20 分鐘的回波推估。`, min30: "30 分", min60: "60 分",
    nhAmount: (mm) => `未來一小時約 ${mm} 毫米。`,
    air: "空氣品質", aqiLevels: ["良好", "普通", "對敏感族群不健康", "對所有族群不健康", "非常不健康", "危害"],
    aqiNote: (pm) => `${pm != null ? `PM2.5 ${pm} µg/m³ · ` : ""}美國 AQI 標準，模式估計`,
    uv: "紫外線指數", uvLevels: ["低量級", "中量級", "高量級", "過量級", "危險級"],
    uvToday: (v, level) => `今日最高 ${v}，${level}。`,
    sunsetAt: (t) => `日落 ${t}`, sunriseAt: (t) => `日出 ${t}`, tomorrowSunset: (t) => `明天 · 日落 ${t}`,
    wind: "風", windSpeed: (v, force) => `${v} <small>公尺/秒 · ${force} 級</small>`, from: (dir) => `${dir}風`,
    gust: (v) => `陣風 ${v} 公尺/秒`,
    dirs: { N: "北", NNE: "北北東", NE: "東北", ENE: "東北東", E: "東", ESE: "東南東", SE: "東南", SSE: "南南東", S: "南",
      SSW: "南南西", SW: "西南", WSW: "西南西", W: "西", WNW: "西北西", NW: "西北", NNW: "北北西" },
    rain: "降雨量", rainToday: (v) => `${v} <small>毫米（今天）</small>`, rainNext: (v) => `未來 24 小時預計 ${v} 毫米。`,
    feels: "體感溫度", feelsSame: "與實際溫度相近。", feelsWarmer: "濕度讓體感更熱。", feelsCooler: "風讓體感更涼。",
    humidity: "濕度", dew: (t) => `目前露點 ${t}。`,
    visibility: "能見度", km: "公里", visClear: "視野清晰。", visHaze: "霾害降低能見度。", visPoor: "能見度差。",
    pressure: "氣壓", hPa: "百帕", pressureTrend: { steady: "穩定", rising: "上升", falling: "下降" },
    pressureNote: (trend) => `過去 3 小時${trend}。`,
    moon: "月相", moonNames: ["新月", "眉月", "上弦月", "盈凸月", "滿月", "虧凸月", "下弦月", "殘月"],
    moonNote: (lit, md) => `亮度 ${lit}% · 下次滿月 ${md}`,
    howTitle: "預報怎麼來的",
    howText: (models) => `每小時的預報結合中央氣象署的鄉鎮預報與 ${models} 個數值模式。最近的氣象站把接下來幾小時拉向它現在的
實測值；每次執行都會用測站資料檢查先前的預報，在這裡常常不準的來源，權重就會降低。各來源的溫度誤差（°C），以及樣本數與偏差：`,
    source: "來源", hours: (a, b) => `${a}–${b} 小時`,
    footer: (t, map) => `更新 ${t} · 資料：中央氣象署、Open-Meteo${map ? `，地圖 © OpenStreetMap 貢獻者${map === 2 ? "，雷達 © RainViewer" : ""}` : ""}`,
    here: "目前位置", add: "新增", addTitle: "新增地點", search: "搜尋鄉鎮市區，例如 東區", remove: "移除",
    cancel: "取消", settings: "設定", language: "語言", notifications: "目前位置的通知",
    notifyRain: "一小時內下雨", notifyWarnings: "新的天氣特報", on: "開", off: "關", loading: "載入中…",
    updating: (t) => `更新中…（目前顯示 ${t} 的預報）`,
    timing: (x) => `上次切換：預報 ${(x.forecast / 1000).toFixed(1)} 秒${x.saved ? "（先顯示已存的）" : ""}，頁面 ${(x.page / 1000).toFixed(1)} 秒`, loadFailed: "無法載入預報。", tryAgain: "再試一次",
    rainSoonTitle: (place) => `🌧️ 即將下雨 · ${place}`, warnBody: (t) => `至 ${t} · 中央氣象署`,
    testButton: "傳送測試通知", testTitle: "🔔 TaiwanWeather",
    testBodyApp: "通知正常。小工具下次更新時會再傳一則測試。", testBodyWidget: "小工具的通知也正常。",
    keyTitle: "CWA 授權碼", keyPrompt: "請貼上氣象資料開放平臺的授權碼（會員 → 取得授權碼）。",
    keyRejected: (e) => `${e}\n請貼上新的授權碼，或按「略過」保留目前的。`, save: "儲存", skip: "略過",
  },
};
let LANG = "en";
const setLang = (lang) => { LANG = WORDS[lang] ? lang : "en"; };
const T = () => WORDS[LANG];

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

// The rain line: the first hour with a chance of rain (20 %+), or the first where rain is likely (50 %+) when that
// follows within 3 hours, with its chance. "Rain now" only when the station sees rain.
function nowText(r) {
  const s = r.summary, w = T();
  if (!s.nextRain) return w.noRainShort;
  const soon = s.likelyRain && keyToDate(s.likelyRain) - keyToDate(s.nextRain) <= 3 * HOUR;
  const key = soon ? s.likelyRain : s.nextRain, pop = Math.round(soon ? s.likelyRainPop : s.nextRainPop);
  if (keyToDate(key) <= Date.now()) { // that hour has begun
    return (stationRain(r) ? w.rainNowShort : pop >= 50 ? w.rainLikelyNowShort : w.rainChanceShort)(pop);
  }
  const tmrw = key.slice(0, 10) !== hourKey(new Date()).slice(0, 10);
  return w.rainAtShort(tmrw, fmtHour(key) + ":00", pop);
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
  const hiLo = T().hiLo(fmtT(r.summary.hi), fmtT(r.summary.lo));
  w.refreshAfterDate = new Date(Date.now() + CONFIG.refreshMinutes * 60e3); // iOS may wait longer
  // A tap opens the full view (a pinned widget's on its place). Set here, it works whatever the widget's
  // "When Interacting" option says; Scriptable's default, Open App, only opens the app.
  const open = "scriptable:///run/" + encodeURIComponent(Script.name());
  w.url = r.pinned ? `${open}?place=${encodeURIComponent(r.pinned)}` : open;

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
        addText(w, T().tomorrowLine(fmtT(t.hi), fmtT(t.lo), t.pop == null ? "–" : Math.round(t.pop) + "%"),
          12, { color: C.dim, minScale: 0.7 });
      }
    } else {
      addHourRow(w, r.rows, 1, CONFIG.hoursShown, 2);
    }
  }
  w.addSpacer();
  const time = new Date(r.updated).toTimeString().slice(0, 5);
  if (warning) addText(w, `${r.stale ? T().stale + " · " : ""}${warning} · ${time}`, 9, { color: C.warn, minScale: 0.7 });
  else {
    addText(w, `${r.stale ? `⚠︎ ${T().stale} · ` : ""}${time}` +
      (r.station ? ` · ${r.station.name} ${r.station.distance.toFixed(1)}km` : ""), 9, { color: C.dim, minScale: 0.8 });
  }
  return w;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const EMOJI = { "sun.max.fill": "☀️", "moon.stars.fill": "🌙", "cloud.sun.fill": "⛅", "cloud.moon.fill": "☁️",
  "cloud.fill": "☁️", "cloud.rain.fill": "🌧️", "cloud.drizzle.fill": "🌦️", "cloud.bolt.rain.fill": "⛈️",
  "cloud.fog.fill": "🌫️", "cloud.snow.fill": "🌨️" };
// CWA's 降雨雷達 (C-band, every 2 minutes). Each image is 3600 px square, centred on its radar, at 1779 px per
// 150 km (measured from the range rings and checked against the coastline to about 1 km); the website's 1000 px
// versions are the same picture scaled down. `id` is its open-data set, `code` its name on the website.
const RAIN_RADARS = [
  { name: "樹林", id: "O-A0084-001", code: "RCSL", latitude: 25.00, longitude: 121.40 },
  { name: "南屯", id: "O-A0084-002", code: "RCNT", latitude: 24.14, longitude: 120.58 },
  { name: "林園", id: "O-A0084-003", code: "RCLY", latitude: 22.53, longitude: 120.38 },
];
// Where loc falls on a 降雨雷達 image (3600 or 1000 px), in pixels from its top-left corner.
function rainRadarPixel(radar, loc, size = 3600) {
  const k = (1779 / 150) * (size / 3600), rad = Math.PI / 180, c = size / 2 - 0.5;
  const north = 6371 * (loc.latitude - radar.latitude) * rad;
  const east = 6371 * (loc.longitude - radar.longitude) * rad * Math.cos(((loc.latitude + radar.latitude) / 2) * rad);
  return [c + east * k, c - north * k];
}
// The full view is loaded as a page of CWA's website (its base URL): the site doesn't let other pages read its
// images' pixels (no CORS), and the next-hour forecast reads the 降雨雷達 images. The page sends no referrer.
const CWA_SITE = "https://www.cwa.gov.tw/";

// Upper limits of each level (names in WORDS): AQI with its colour, and UV.
const AQI_LEVELS = [[50, "#4cd964"], [100, "#ffcc00"], [150, "#ff9500"], [200, "#ff3b30"], [300, "#af52de"], [Infinity, "#8e1b3a"]];
const UV_LEVELS = [2, 5, 7, 10, Infinity];
const levelOf = (limits, v) => limits.findIndex((x) => v <= (Array.isArray(x) ? x[0] : x));
const hm = (minutes) => {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
// An ISO time as Taiwan's "HH:MM", with the date ("10/12 21:05") when it isn't today.
const twTime = (iso) => {
  const t = new Date(Date.parse(iso) + 8 * HOUR).toISOString(), today = new Date(Date.now() + 8 * HOUR).toISOString();
  return (t.slice(0, 10) === today.slice(0, 10) ? "" : t.slice(5, 10).replace("-", "/") + " ") + t.slice(11, 16);
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
// The rain part of the hourly card's first sentence, from a rainSummary(): the first chance of rain, and when
// that's under 50 %, the first hour rain is likely too. raining: the station sees rain ("Rain now"); when(key):
// the time to name for an hour.
function rainSentence(s, raining, when = (k) => fmtHour(k) + ":00") {
  const w = T();
  if (!s.nextRain) return w.noRain24;
  const pop = (p) => Math.round(p) + "%", tmrw = (k) => k.slice(0, 10) !== hourKey(new Date()).slice(0, 10);
  const likely = s.nextRainPop >= 50;
  let text = keyToDate(s.nextRain) <= Date.now()
    ? (raining ? w.rainNowLong : likely ? w.rainLikelyNowLong : w.rainChanceNowLong)(pop(s.nextRainPop))
    : (likely ? w.rainAtLong : w.rainChanceAtLong)(tmrw(s.nextRain), when(s.nextRain), pop(s.nextRainPop));
  if (!likely && s.likelyRain) text += (LANG === "zh" ? "" : " ") + w.rainAtLong(tmrw(s.likelyRain), when(s.likelyRain), pop(s.likelyRainPop));
  return text;
}
const gustText = (r) => (r.gustMax >= 10.8 ? T().gusts(Math.round(r.gustMax)) : ""); // Beaufort 6 and up

// One sentence for the top of the hourly card, like the Weather app's. Once the full view has read the radar,
// its page puts the radar's own sentence for the coming hour first (see detailHTML).
function outlook(r) {
  return rainSentence(r.summary, stationRain(r)) + gustText(r);
}

// The full view: what opens when you tap a widget or run the script in Scriptable. Links to tw-weather://…
// (places, language, notifications) are handled by main(). ui = { settings, current: "here" or a place index }.
function detailHTML(r, ui = {}) {
  const w = T(), settings = ui.settings || DEFAULT_SETTINGS, places = settings.places || [];
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
  const act = (path) => `tw-weather://${path}`;

  // Swiping, or the dots at the bottom, moves between My Location and the saved places, as in the Weather app.
  const order = ["here", ...places.map((_, i) => i)], at = Math.max(0, order.indexOf(ui.current ?? "here"));
  const dots = order.length < 2 ? "" : `<nav class="dots">${order.map((p, i) =>
    `<a class="dot${i === at ? " on" : ""}" href="${act(`show?place=${p}&dir=${i > at ? "left" : "right"}`)}" ` +
    `aria-label="${p === "here" ? w.here : esc(places[p].county + places[p].name)}">${p === "here" ? "➤" : "●"}</a>`).join("")}</nav>`;

  // Places: My Location, saved townships (the current one can be removed), and Add.
  const current = ui.current ?? "here";
  const chips = [`<a class="chip${current === "here" ? " on" : ""}" href="${act("show?place=here")}">📍 ${w.here}</a>`,
    ...places.map((p, i) => `<a class="chip${current === i ? " on" : ""}" href="${act("show?place=" + i)}">${esc(p.county + p.name)}</a>` +
      (current === i ? `<a class="chip x" href="${act("remove?place=" + i)}" aria-label="${w.remove}">✕</a>` : "")),
    `<button class="chip" id="add" type="button">＋ ${w.add}</button>`].join("");

  // Hourly strip, with sunrise and sunset slotted in where they fall.
  const events = (r.sun || []).flatMap((s) => [[s.day, s.rise, "🌅", w.sunrise], [s.day, s.set, "🌇", w.sunset]]);
  const hours = r.rows.slice(0, 25).flatMap((h, i) => {
    const day = h.key.slice(0, 10), hour = Number(fmtHour(h.key));
    const sun = events.filter(([on, m]) => on === day && Math.floor(m / 60) === hour && !(on === today && m < minuteNow))
      .map(([, m, e, label]) => `<li class="sun"><span>${hm(m)}</span><b>${e}</b><small></small><span>${label}</span></li>`);
    return [`<li><span>${i ? fmtHour(h.key) : w.now}</span><b>${EMOJI[i ? wxSymbol(h.wx, h.pop, h.night) : symbol]}</b>` +
      `<small>${h.pop != null && h.pop >= CONFIG.rainChance ? Math.round(h.pop) + "%" : ""}</small><span>${fmtT(i ? h.t : cur)}</span></li>`, ...sun];
  }).join("");

  // Ten days, each bar placed on the range of the whole ten days.
  const days = r.days || [];
  const lo = Math.min(...days.map((x) => x.lo)), hi = Math.max(...days.map((x) => x.hi)), span = Math.max(1, hi - lo);
  const pct = (t) => (((Math.min(hi, Math.max(lo, t)) - lo) / span) * 100).toFixed(1);
  const dayRows = days.map((x, i) => {
    const name = i ? w.weekdays[new Date(Date.parse(x.day + "T12:00:00+08:00")).getUTCDay()] : w.today;
    const dot = i === 0 && cur != null ? `<em style="left:${pct(cur)}%"></em>` : "";
    return `<li><span>${name}</span><b>${EMOJI[wxSymbol(x.wx, x.pop, false)]}<small>${x.pop >= CONFIG.rainChance ? Math.round(x.pop) + "%" : ""}</small></b>` +
      `<span class="lo">${fmtT(x.lo)}</span><span class="bar"><i style="left:${pct(x.lo)}%;right:${(100 - pct(x.hi)).toFixed(1)}%;` +
      `background:linear-gradient(90deg,${tempColor(x.lo)},${tempColor(x.hi)})"></i>${dot}</span><span>${fmtT(x.hi)}</span></li>`;
  }).join("");

  // Detail tiles; each appears only when its data came in.
  const tiles = [];
  if (r.air && r.air.aqi != null) {
    const level = levelOf(AQI_LEVELS, r.air.aqi);
    tiles.push(tile(`🫁 ${w.air}`, `${Math.round(r.air.aqi)} <small>${w.aqiLevels[level]}</small>`,
      `<span class="scale aqi"><em style="left:${Math.min(100, r.air.aqi / 3).toFixed(1)}%;border-color:${AQI_LEVELS[level][1]}"></em></span>` +
      w.aqiNote(r.air.pm25 != null ? Math.round(r.air.pm25) : null)));
  }
  if (d.uv != null) {
    const max = days[0] && days[0].uv;
    tiles.push(tile(`😎 ${w.uv}`, `${Math.round(d.uv)} <small>${w.uvLevels[levelOf(UV_LEVELS, d.uv)]}</small>`,
      `<span class="scale uv"><em style="left:${Math.min(100, d.uv * 9)}%"></em></span>` +
      (max != null ? w.uvToday(Math.round(max), w.uvLevels[levelOf(UV_LEVELS, max)]) : "")));
  }
  if (r.sun && r.sun.length === 2) {
    const [t0, t1] = r.sun;
    tiles.push(minuteNow < t0.rise ? tile(`🌅 ${w.sunrise}`, hm(t0.rise), w.sunsetAt(hm(t0.set)))
      : minuteNow > t0.set ? tile(`🌅 ${w.sunrise}`, hm(t1.rise), w.tomorrowSunset(hm(t1.set)))
      : tile(`🌇 ${w.sunset}`, hm(t0.set), w.sunriseAt(hm(t0.rise))));
  }
  if (d.wind != null) {
    const dir = d.windDir != null ? compass(d.windDir) : null;
    const arrow = dir ? `<i class="arrow" style="transform:rotate(${Math.round(d.windDir + 180)}deg)">↑</i>` : "";
    tiles.push(tile(`🌬️ ${w.wind}`, w.windSpeed(d.wind.toFixed(1), beaufort(d.wind)),
      arrow + [dir && w.from(w.dirs[dir] || dir), d.gust != null && w.gust(d.gust.toFixed(1))].filter(Boolean).join(" · ")));
  }
  if (r.rainToday != null || r.rainNext24 != null) {
    tiles.push(tile(`💧 ${w.rain}`, w.rainToday((r.rainToday || 0).toFixed(1)), w.rainNext((r.rainNext24 || 0).toFixed(1))));
  }
  if (d.feels != null && cur != null) {
    const gap = d.feels - cur;
    tiles.push(tile(`🌡️ ${w.feels}`, fmtT(d.feels), Math.abs(gap) < 1 ? w.feelsSame : gap > 0 ? w.feelsWarmer : w.feelsCooler));
  }
  if (d.rh != null) tiles.push(tile(`💦 ${w.humidity}`, `${Math.round(d.rh)}%`, d.dew != null ? w.dew(fmtT(d.dew)) : ""));
  if (d.visibility != null) {
    const km = d.visibility / 1000;
    tiles.push(tile(`👁️ ${w.visibility}`, `${km >= 10 ? Math.round(km) : km.toFixed(1)} <small>${w.km}</small>`,
      km >= 10 ? w.visClear : km >= 4 ? w.visHaze : w.visPoor));
  }
  if (d.pressure != null) {
    const c = d.pressureChange, trend = c == null || Math.abs(c) < 0.5 ? "steady" : c > 0 ? "rising" : "falling";
    tiles.push(tile(`🧭 ${w.pressure}`, `${Math.round(d.pressure)} <small>${w.hPa}</small>`, w.pressureNote(w.pressureTrend[trend])));
  }
  if (r.moon) {
    const full = new Date(new Date(r.moon.nextFull).getTime() + 8 * HOUR);
    tiles.push(tile(`${r.moon.emoji} ${w.moon}`, w.moonNames[r.moon.phase ?? 0],
      w.moonNote(Math.round(r.moon.lit * 100), `${full.getUTCMonth() + 1}/${full.getUTCDate()}`)));
  }

  // Radar: RainViewer's last two hours as an animation, else CWA's latest image.
  const frames = r.frames && r.frames.frames.length ? r.frames.frames.map((f) => ({
    url: `${r.frames.host}${f.path}/256/{z}/{x}/{y}/2/0_0.png`, time: hm(((f.time / 60000) + 8 * 60) % 1440) })) : [];
  const cwaRadar = r.radar && r.radar.url ? { url: r.radar.url, bounds: r.radar.bounds, time: r.radar.time ? String(r.radar.time).slice(11, 16) : "" } : null;
  const mapSource = frames.length ? 2 : cwaRadar ? 1 : 0;
  // CWA's 降雨雷達 as a second tab, nearest radar first; its image (about 1 MB) loads only when opened.
  const rainRadars = r.loc ? RAIN_RADARS.map((s) => ({ name: s.name, km: distanceKm(r.loc, s), px: rainRadarPixel(s, r.loc),
    url: `https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/${s.id}.png`,
    time: String((r.rainRadarTimes || {})[s.id] || "").slice(11, 16) })).sort((a, b) => a.km - b.km) : [];
  const radar = mapSource && r.loc ? card(`🛰️ ${w.radar}`,
    `<div class="tabs"><button type="button" class="on" data-tab="move">${w.radarTabs[0]}</button>` +
    `<button type="button" data-tab="cwa">${w.radarTabs[1]}</button></div><div id="map"></div>` +
    `<div id="cwa-view" hidden><div class="tabs" id="stations">${rainRadars.map((s, i) =>
      `<button type="button" data-i="${i}"${i ? "" : ' class="on"'}>${s.name}</button>`).join("")}</div>` +
    `<div id="cwa-map"></div><p class="note" id="cwa-note">${esc(w.cwaRadarNote(rainRadars[0].name, rainRadars[0].time))}</p></div>` +
    `<p class="note" id="radar-note">` + (frames.length ? `<button id="play" type="button">▶︎ ${w.play}</button> ` : "") +
    `<span id="radar-time">${esc(w.radarNote(frames.length ? "RainViewer" : w.radar, frames.length ? frames[frames.length - 1].time : cwaRadar.time))}</span></p>`) : "";
  // The next hour, worked out in the page from radar images, their colours read back as dBZ: the last 20 minutes
  // of the nearest CWA 降雨雷達 that sees where you are (every 2 minutes, from 145 km), else RainViewer's.
  const twHM = (ms) => hm((ms / 60000 + 8 * 60) % 1440);
  const nhRadars = r.loc ? RAIN_RADARS.map((s) => ({ s, km: distanceKm(r.loc, s) })).filter((x) => x.km <= 145)
    .sort((a, b) => a.km - b.km).map(({ s }) => ({ s, frames: pickFrames((r.rainFrames || {})[s.code]) }))
    .filter((x) => x.frames.length >= 2).map(({ s, frames: list }) => ({ name: s.name, px: rainRadarPixel(s, r.loc, 1000),
      frames: list.map((f) => ({ url: CWA_SITE + "Data/radar_rain/" + f.path, time: f.time })),
      note: w.nhFromCWA(s.name, twHM(list[list.length - 1].time)) })) : [];
  const nhRV = frames.length >= 3 ? { host: r.frames.host, frames: r.frames.frames.slice(-3), note: w.nhFromRV(frames[frames.length - 1].time) } : null;
  const nextHour = r.loc && (nhRadars.length || nhRV) ? card(`☔ ${w.nextHour}`, `<p class="summary" id="nh-text">${w.loading}</p>` +
    `<div class="nh-chart" id="nh-chart"></div><p class="nh-axis"><span>${w.now}</span><span>${w.min30}</span><span>${w.min60}</span></p>` +
    `<p class="nh-note" id="nh-source"></p>`) : "";
  const nhWords = { none: w.nhNone, start: w.nhStart, stop: w.nhStop, all: w.nhAll, kinds: w.nhKinds, unavailable: w.nhUnavailable,
    amount: w.nhAmount("{mm}") };
  // Once the radar is read, the hourly card follows it for the coming hour (radarOutlook): the hours it decides are
  // this one, and the next when half of it or more falls in the coming hour; after them, the forecast. An hour
  // starting before the coming hour is over is named by when that is ("23:30"), not by its start.
  const minute = minuteNow % 60, decided = minute >= 30 ? 2 : 1, end = Date.now() + HOUR;
  const nhPlan = { minute, decided, sep: LANG === "zh" ? "" : " ", none24: w.noRain24, gust: gustText(r), keepNow: stationRain(r),
    later: (() => {
      const later = rainSummary(r.rows.slice(decided, 24));
      const when = (k) => (keyToDate(k) < end ? hm(Math.floor((minuteNow + 60) / 5) * 5 % 1440) : fmtHour(k) + ":00");
      return later.nextRain ? rainSentence(later, false, when) : "";
    })() };

  const srcNames = { cwa: "CWA 鄉鎮預報" };
  const skillRows = Object.entries(r.skill).map(([src, buckets]) =>
    `<tr><td>${srcNames[src] || src}</td>${buckets.map((p) =>
      `<td>${p.mae.toFixed(2)}° <small>${p.n}${p.n ? `, ${p.bias >= 0 ? "+" : ""}${p.bias.toFixed(1)}` : ""}</small></td>`).join("")}</tr>`).join("");
  const warnings = (r.warnings || []).map((x) =>
    `<p><b>⚠️ ${esc(x.title)}</b> <span>${w.until(esc(shortTime(x.until)))}</span></p>`).join("");
  const models = r.sources.filter((s) => s !== "cwa").length;
  const toggle = (key, label) => `<p class="row"><span>${label}</span><a class="seg-btn${settings.notify[key] ? " on" : ""}" ` +
    `href="${act(`notify?${key}=${settings.notify[key] ? 0 : 1}`)}">${settings.notify[key] ? w.on : w.off}</a></p>`;
  const townNames = TOWN_POINTS.map((t) => t.county + t.name);

  return `<html lang="${LANG === "zh" ? "zh-Hant-TW" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer">
${radar ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">` : ""}
<style>
:root { color-scheme: dark; --glass: rgba(10, 20, 40, .28); --line: rgba(255, 255, 255, .16); --dim: rgba(255, 255, 255, .64); }
[hidden] { display: none !important; }
body { margin: 0; color: #fff; font: 16px/1.35 -apple-system, system-ui, sans-serif; min-height: 100vh;
  background: #2f6fbd; background-attachment: fixed; }
.clear-day { background-image: linear-gradient(#2f6fd0, #5aa9e6); } .cloudy-day { background-image: linear-gradient(#5b7590, #8ea4ba); }
.rain-day { background-image: linear-gradient(#45566b, #73849a); } .clear-night { background-image: linear-gradient(#0a1631, #1f3d72); }
.cloudy-night, .rain-night { background-image: linear-gradient(#121a28, #2c3a51); }
main { max-width: 560px; margin: 0 auto; padding: max(14px, env(safe-area-inset-top)) 16px 64px; display: grid; gap: 12px; }
.places { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
.chip { flex: 0 0 auto; color: #fff; text-decoration: none; font: 14px -apple-system, system-ui, sans-serif; padding: 6px 12px;
  border-radius: 16px; background: var(--glass); border: 0; } .chip.on { background: rgba(255, 255, 255, .28); } .chip.x { padding: 6px 10px; }
.hero { text-align: center; padding: 4px 0 14px; text-shadow: 0 1px 6px rgba(0, 0, 0, .18); }
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
[class*="-night"] #map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9); } /* dark map at night */
#play { font: 600 13px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(255, 255, 255, .2); border: 0;
  border-radius: 12px; padding: 4px 10px; margin-right: 6px; }
.note, .nh-note, footer { color: var(--dim); font-size: 12px; } .note { margin: 8px 0 0; display: flex; align-items: center; }
.nh-note { margin: 8px 0 0; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 6px 0; font-size: 15px; }
.seg { display: flex; gap: 4px; } .seg-btn { color: #fff; text-decoration: none; padding: 4px 12px; border-radius: 12px;
  background: rgba(0, 0, 0, .2); font-size: 14px; } .seg-btn.on { background: rgba(255, 255, 255, .3); }
details summary { cursor: pointer; font-size: 15px; } details p { font-size: 14px; color: var(--dim); }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
td, th { padding: 4px 2px; border-top: 1px solid var(--line); text-align: left; } td small { color: var(--dim); }
footer { text-align: center; line-height: 1.6; } .err { color: #ffd166; }
.sheet { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); padding: max(40px, env(safe-area-inset-top)) 16px 16px; z-index: 2000; }
.sheet .card { max-width: 528px; margin: 0 auto; background: #1d2a40; max-height: 80vh; display: grid; grid-template-rows: auto auto 1fr auto; gap: 10px; }
.sheet input { font: 17px -apple-system, system-ui, sans-serif; padding: 10px 12px; border-radius: 10px; border: 0;
  background: rgba(255, 255, 255, .12); color: #fff; width: 100%; box-sizing: border-box; }
.sheet ol { list-style: none; margin: 0; padding: 0; overflow-y: auto; } .sheet li a { display: block; padding: 10px 4px;
  color: #fff; text-decoration: none; border-top: 1px solid var(--line); }
.sheet button { font: 15px -apple-system, system-ui, sans-serif; color: #7cc4ff; background: none; border: 0; padding: 6px; }
body.busy::after { content: attr(data-loading); position: fixed; inset: 0; display: grid; place-items: center;
  background: rgba(0, 0, 0, .35); font-size: 17px; z-index: 3000; }
main { touch-action: pan-y; transition: transform .25s ease, opacity .25s ease; } main.drag { transition: none; }
body[data-enter="left"] main { animation: from-right .3s ease-out; } body[data-enter="right"] main { animation: from-left .3s ease-out; }
@keyframes from-right { from { transform: translateX(45%); opacity: 0; } } @keyframes from-left { from { transform: translateX(-45%); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { main, body[data-enter] main { animation: none; transition: none; } }
.incoming { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; gap: 6px; animation: fade .2s; }
.incoming p { margin: 0; } @keyframes fade { from { opacity: 0; } }
.dots { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: 12px; z-index: 1500;
  padding: 12px 0 max(12px, env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgba(0, 0, 0, .3)); }
.dot { color: rgba(255, 255, 255, .45); text-decoration: none; font-size: 10px; line-height: 1; } .dot.on { color: #fff; }
.tabs { display: flex; gap: 6px; margin-bottom: 8px; overflow-x: auto; }
.tabs button { flex: 0 0 auto; font: 13px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, .2);
  border: 0; border-radius: 12px; padding: 4px 11px; } .tabs button.on { background: rgba(255, 255, 255, .3); }
#cwa-map { height: 330px; border-radius: 10px; background: #e6e9ee; }
.nh-chart { display: flex; align-items: flex-end; gap: 3px; height: 54px; }
.nh-chart i { flex: 1; min-height: 2px; background: #7cc4ff; border-radius: 2px 2px 0 0; }
.nh-axis { display: flex; justify-content: space-between; margin: 4px 0 0; font-size: 12px; color: var(--dim); }
</style></head><body class="${sky}" data-loading="${w.loading}" data-enter="${ui.enter || ""}"><main>
<nav class="places">${chips}</nav>
<header class="hero">
  <p class="place">${esc(r.place)}</p>
  <p class="via">${r.placeVia ? esc(w.via[r.placeVia] || r.placeVia) : ""}${r.station ? " · " + w.station(esc(r.station.name), r.station.distance.toFixed(1)) : ""}</p>
  ${r.updating ? `<p class="via" id="updating">↻ ${esc(w.updating(twTime(r.updated)))}</p>` : ""}
  <p class="temp">${fmtT(cur)}</p>
  <p class="cond">${esc(wx)}</p>
  <p class="hl">${w.hiLoWide(fmtT(r.summary.hi), fmtT(r.summary.lo))}</p>
</header>
${r.stale ? card("", `<p>${w.staleBanner} ${esc(r.errors.join("; "))}</p>`, "alert") : ""}
${warnings ? card("", warnings, "alert") : ""}
${nextHour}
${card("", `<p class="summary" id="outlook">${outlook(r)}</p><ol class="hours">${hours}</ol>`)}
${days.length ? card(`📅 ${w.days(days.length)}`, `<ol class="days">${dayRows}</ol>`) : ""}
${radar}
${tiles.length ? `<div class="tiles">${tiles.join("")}</div>` : ""}
${card(`⚙️ ${w.settings}`, `<p class="row"><span>${w.language}</span><span class="seg">` +
  `<a class="seg-btn${LANG === "en" ? " on" : ""}" href="${act("lang?to=en")}">English</a>` +
  `<a class="seg-btn${LANG === "zh" ? " on" : ""}" href="${act("lang?to=zh")}">中文</a></span></p>` +
  `<h2 style="margin-top:12px">${w.notifications}</h2>${toggle("rain", w.notifyRain)}${toggle("warnings", w.notifyWarnings)}` +
  `<p class="row"><span></span><a class="seg-btn" href="${act("test")}">${w.testButton}</a></p>`)}
${card("", `<details><summary>${w.howTitle}</summary><p>${w.howText(models)}</p>
<table><tr><th>${w.source}</th><th>${w.hours(0, 6)}</th><th>${w.hours(6, 24)}</th><th>${w.hours(24, 48)}</th></tr>${skillRows}</table></details>`)}
<footer>${w.footer(new Date(r.updated).toTimeString().slice(0, 5), radar ? mapSource : 0)}${ui.timing ? "<br>" + w.timing(ui.timing) : ""}
${r.errors.length && !r.stale ? `<br><span class="err">${r.errors.map(esc).join("<br>")}</span>` : ""}</footer>
</main>
${dots}
<div class="incoming" id="incoming" hidden><p class="place" id="incoming-name"></p><p>${w.loading}</p></div>
<div class="sheet" id="picker" hidden><div class="card"><h2>${w.addTitle}</h2>
<input id="q" type="search" placeholder="${esc(w.search)}" autocomplete="off"><ol id="results"></ol>
<button type="button" id="cancel">${w.cancel}</button></div></div>
<script>
const towns = ${JSON.stringify(townNames)};
const picker = document.getElementById("picker"), q = document.getElementById("q"), results = document.getElementById("results");
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href^="tw-weather:"]')) document.body.classList.add("busy");
});
function search() {
  const text = q.value.trim().replace(/台/g, "臺");
  results.innerHTML = "";
  for (const name of towns.filter((t) => text && t.includes(text)).slice(0, 40)) {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = "tw-weather://add?place=" + encodeURIComponent(name);
    a.textContent = name;
    li.appendChild(a);
    results.appendChild(li);
  }
}
q.addEventListener("input", search);
document.getElementById("add").addEventListener("click", () => { picker.hidden = false; q.value = ""; search(); q.focus(); });
document.getElementById("cancel").addEventListener("click", () => { picker.hidden = true; });

// Swipe left or right between places; the page follows the finger, as in the Weather app. If the next place
// takes a moment, its name shows with "Loading…".
const order = ${JSON.stringify(order)}, at = ${at};
const names = ${JSON.stringify(order.map((p) => (p === "here" ? w.here : places[p].county + places[p].name)))};
let touching = false;
(() => {
  const main = document.querySelector("main"), incoming = document.getElementById("incoming");
  let x0 = null, y0 = 0, dx = 0, sideways = null;
  const own = (t) => t.closest(".hours, #map, #cwa-map, .places, .tabs, .sheet, input, table");
  document.addEventListener("touchstart", (e) => {
    touching = true;
    x0 = order.length > 1 && !own(e.target) ? e.touches[0].clientX : null;
    y0 = e.touches[0].clientY; dx = 0; sideways = null;
  }, { passive: true });
  document.addEventListener("touchcancel", () => {
    touching = false; x0 = null;
    main.classList.remove("drag"); main.style.transform = "";
  });
  document.addEventListener("touchmove", (e) => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (sideways == null && Math.abs(dx) + Math.abs(dy) > 10) sideways = Math.abs(dx) > Math.abs(dy);
    if (!sideways) return;
    e.preventDefault();
    const edge = (dx > 0 && at === 0) || (dx < 0 && at === order.length - 1); // nothing there: resist
    main.classList.add("drag");
    main.style.transform = "translateX(" + (edge ? dx / 3 : dx) + "px)";
  }, { passive: false });
  document.addEventListener("touchend", () => {
    touching = false;
    if (x0 == null || !sideways) { x0 = null; return; }
    main.classList.remove("drag");
    const next = at + (dx < 0 ? 1 : -1);
    if (Math.abs(dx) > 70 && next >= 0 && next < order.length) {
      main.style.transform = "translateX(" + (dx < 0 ? -100 : 100) + "%)";
      main.style.opacity = "0";
      location.href = "tw-weather://show?place=" + order[next] + "&dir=" + (dx < 0 ? "left" : "right");
      setTimeout(() => {
        document.getElementById("incoming-name").textContent = names[next];
        incoming.hidden = false;
        document.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("on", i === next));
      }, 300);
    } else {
      main.style.transform = "";
    }
    x0 = null;
  });
})();
// For the script: how far the page is scrolled, and whether redrawing it now would get in the way.
window.pageState = () => ({ y: Math.round(window.scrollY), busy: touching || !picker.hidden ||
  !!document.querySelector("#cwa-view:not([hidden])") || document.body.classList.contains("playing") });
${ui.scrollY ? `window.scrollTo(0, ${Math.round(ui.scrollY)});` : ""}
</script>
${radar ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
const here = [${r.loc.latitude}, ${r.loc.longitude}], frames = ${JSON.stringify(frames)}, cwa = ${JSON.stringify(cwaRadar)};
const note = ${JSON.stringify(frames.map((f) => w.radarNote("RainViewer", f.time)))};
const rainRadars = ${JSON.stringify(rainRadars)}, cwaNotes = ${JSON.stringify(rainRadars.map((s) => w.cwaRadarNote(s.name, s.time)))};
const TAIWAN = [[20.6, 117.6], [27.0, 123.4]]; // Taiwan with Kinmen, Matsu and Lanyu: the map can't wander off
// The map starts once the page has loaded, so its tiles don't hold up the page, or the next swipe.
addEventListener("load", () => {
if (window.L) {
  const map = L.map("map", { zoomControl: false, minZoom: 7, maxBounds: TAIWAN, maxBoundsViscosity: 1 }).setView(here, 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", // free for light personal use, with credit
    { minZoom: 7, maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(map);
  if (frames.length) {
    // Radar in its own pane, so the night filter on the base map leaves its colours alone. Every frame
    // loads at once (hidden), so the animation doesn't wait for tiles. Each tile goes through a canvas that drops
    // RainViewer's see-through tan (under 15 dBZ: drizzle, or clutter on a dry day), as the next-hour card does.
    map.createPane("radar").style.zIndex = 450;
    const Radar = L.GridLayer.extend({ createTile(c, done) {
      const tile = document.createElement("canvas"), img = new Image();
      tile.width = tile.height = 256;
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const ctx = tile.getContext("2d");
        ctx.drawImage(img, 0, 0);
        try {
          const d = ctx.getImageData(0, 0, 256, 256);
          for (let i = 3; i < d.data.length; i += 4) if (d.data[i] < 255) d.data[i] = 0;
          ctx.putImageData(d, 0, 0);
        } catch (e) { /* no CORS: keep the tile as it is */ }
        done(null, tile);
      };
      img.onerror = () => done(null, tile);
      img.src = this.options.url.replace("{z}", c.z).replace("{x}", c.x).replace("{y}", c.y);
      return tile;
    } });
    const layers = frames.map((f) => new Radar({ url: f.url, pane: "radar", opacity: 0, maxNativeZoom: 7, maxZoom: 12,
      attribution: "radar © RainViewer" }).addTo(map));
    const label = document.getElementById("radar-time"), button = document.getElementById("play");
    let shown = layers.length - 1, timer = null;
    const show = (i) => { layers[shown].setOpacity(0); shown = i; layers[i].setOpacity(0.85); label.textContent = note[i]; };
    show(shown);
    button.addEventListener("click", () => {
      document.body.classList.toggle("playing", !timer);
      if (timer) { clearInterval(timer); timer = null; show(layers.length - 1); button.textContent = ${JSON.stringify("▶︎ " + w.play)}; return; }
      timer = setInterval(() => show((shown + 1) % layers.length), 700);
      button.textContent = ${JSON.stringify("❚❚ " + w.pause)};
    });
  } else if (cwa) {
    L.imageOverlay(cwa.url + "?t=" + Date.now(), cwa.bounds, { opacity: 0.8 }).addTo(map);
  }
  L.circleMarker(here, { radius: 6, color: "#fff", weight: 2, fillColor: "#0a84ff", fillOpacity: 1 }).addTo(map);

  // The CWA 降雨雷達 tab: one radar's image, zoomable but kept inside the image, with your position on it.
  let cwaMap = null;
  const showStation = (i) => {
    document.querySelectorAll("#stations [data-i]").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === i));
    document.getElementById("cwa-note").textContent = cwaNotes[i];
    if (cwaMap) cwaMap.remove();
    const s = rainRadars[i], box = [[-3600, 0], [0, 3600]]; // image pixels, y pointing down
    cwaMap = L.map("cwa-map", { crs: L.CRS.Simple, zoomControl: false, attributionControl: false, zoomSnap: 0.25,
      maxBounds: box, maxBoundsViscosity: 1, minZoom: -6, maxZoom: 1 }); // negative zoom: the image is 3600 px
    L.imageOverlay(s.url + "?t=" + Date.now(), box).addTo(cwaMap);
    cwaMap.fitBounds(box);
    cwaMap.setMinZoom(cwaMap.getZoom());
    const [x, y] = s.px;
    if (x >= 0 && y >= 0 && x <= 3600 && y <= 3600) {
      L.circleMarker([-y, x], { radius: 6, color: "#fff", weight: 2, fillColor: "#0a84ff", fillOpacity: 1 }).addTo(cwaMap);
      cwaMap.setView([-y, x], cwaMap.getZoom() + 1);
    }
  };
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const cwaTab = tab.dataset.tab === "cwa";
    document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("on", t === tab));
    document.getElementById("map").hidden = cwaTab;
    document.getElementById("radar-note").hidden = cwaTab;
    document.getElementById("cwa-view").hidden = !cwaTab;
    if (cwaTab && !cwaMap) showStation(0);
  }));
  document.querySelectorAll("#stations [data-i]").forEach((b) => b.addEventListener("click", () => showStation(Number(b.dataset.i))));
} else {
  document.getElementById("map").textContent = ${JSON.stringify(w.mapOffline)};
}
});
</script>` : ""}
${nextHour ? `<script>
${radarDBZ.toString()}
${rainRadarGrid.toString()}
${nowcastFrom.toString()}
${radarOutlook.toString()}
addEventListener("load", async () => {
  const words = ${JSON.stringify(nhWords)}, cwaRadars = ${JSON.stringify(nhRadars)}, rv = ${JSON.stringify(nhRV)};
  const plan = ${JSON.stringify(nhPlan)};
  const here = [${r.loc.latitude}, ${r.loc.longitude}], box = document.getElementById("nh-text");
  const picture = (url, cors) => new Promise((ok, fail) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("no image"));
    img.src = url;
  });
  // CWA's 降雨雷達: 160 × 160 cells of 4 × 4 pixels of its 1000 px image (1.2 km a side), centred on you. The
  // nearest radar that sees where you are (not behind mountains or too far) and still sends images.
  const SIZE = 160, BLOCK = 4, cwaColors = ${JSON.stringify(CWA_RADAR_COLORS)};
  const cwaGrid = async (s, f) => {
    const img = await picture(f.url, false), canvas = document.createElement("canvas"), side = SIZE * BLOCK;
    const at = (v) => Math.round((SIZE / 2 + 0.5) * BLOCK - 0.5 - v); // your pixel lands in the centre cell
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, at(s.px[0]), at(s.px[1]));
    return rainRadarGrid(ctx.getImageData(0, 0, side, side).data, cwaColors, SIZE, BLOCK);
  };
  const fromCWA = async () => {
    for (const s of cwaRadars) {
      const newest = s.frames[s.frames.length - 1];
      if (Date.now() - newest.time > 25 * 60e3) continue; // this radar has stopped sending
      try {
        const last = await cwaGrid(s, newest), c = SIZE / 2;
        let hidden = 0;
        for (let y = c - 2; y <= c + 2; y++) for (let x = c - 2; x <= c + 2; x++) hidden += last.blind[y * SIZE + x];
        if (hidden > 7) continue; // it can't see the 6 km around you: the next radar
        const grids = [...(await Promise.all(s.frames.slice(0, -1).map((f) => cwaGrid(s, f)))), last];
        const seen = grids.reduce((sum, g) => sum + g.seen, 0), odd = grids.reduce((sum, g) => sum + g.odd, 0);
        if (odd > 200 && odd > seen) throw new Error("CWA's radar colours have changed");
        const gaps = s.frames.slice(1).map((f, i) => (f.time - s.frames[i].time) / 60000);
        return { nc: nowcastFrom(grids.map((g) => g.dbz), SIZE, Math.max(0, (Date.now() - newest.time) / 60000), gaps, 15), note: s.note };
      } catch (e) { /* the next radar, then RainViewer */ }
    }
    return null;
  };
  // RainViewer: a 192 × 192 grid of its zoom-7 tiles' pixels (about 1.1 km), centred on you
  const fromRainViewer = async () => {
    const colors = ${JSON.stringify(RAINVIEWER_COLORS)};
    const zoom = 7, size = 192, n = 256 * 2 ** zoom, lat = here[0] * Math.PI / 180;
    const cx = ((here[1] + 180) / 360) * n, cy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    const grid = async (path) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d"), x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2), jobs = [];
      for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + size - 1) / 256); tx++) {
        for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + size - 1) / 256); ty++) {
          jobs.push(picture(rv.host + path + "/256/" + zoom + "/" + tx + "/" + ty + "/2/0_0.png", true) // exact colours: no smoothing
            .then((img) => ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0)));
        }
      }
      await Promise.all(jobs);
      return radarDBZ(ctx.getImageData(0, 0, size, size).data, colors);
    };
    const grids = await Promise.all(rv.frames.map((f) => grid(f.path)));
    const seen = grids.reduce((sum, g) => sum + g.seen, 0), odd = grids.reduce((sum, g) => sum + g.odd, 0);
    if (odd > 0.05 * seen) throw new Error("RainViewer's colours have changed");
    return { nc: nowcastFrom(grids.map((g) => g.dbz), size, Math.max(0, (Date.now() - rv.frames[2].time) / 60000)), note: rv.note };
  };
  try {
    const found = (cwaRadars.length && (await fromCWA())) || (rv && (await fromRainViewer()));
    if (!found) throw new Error("no radar");
    const s = found.nc.steps, wet = s.map((x) => x.mmh > 0), most = Math.max(...s.map((x) => x.mmh));
    const kind = words.kinds[most < 2.5 ? 0 : most < 10 ? 1 : 2], firstWet = wet.indexOf(true), firstDry = wet.indexOf(false);
    const say = (t, min) => t.replace("{kind}", kind).replace("{min}", min);
    box.textContent = wet[0] ? (firstDry < 0 ? say(words.all) : say(words.stop, s[firstDry].min))
      : firstWet < 0 ? words.none : say(words.start, s[firstWet].min);
    document.getElementById("nh-chart").innerHTML = s.map((x) =>
      '<i style="height:' + (x.mmh ? Math.min(100, 12 + Math.log2(1 + x.mmh) * 22) : 0) + '%"></i>').join("");
    const mm = s.reduce((sum, x, i) => (i ? sum + ((x.mmh + s[i - 1].mmh) / 2) * (x.min - s[i - 1].min) / 60 : 0), 0);
    document.getElementById("nh-source").textContent = found.note + (mm >= 0.1 ? " " + words.amount.replace("{mm}", mm.toFixed(1)) : "");
    // the hourly card follows the radar for the coming hour: its first sentence, and the hours the radar decides
    const ro = radarOutlook(plan, box.textContent, s);
    document.getElementById("outlook").textContent = ro.text;
    [...document.querySelectorAll(".hours li:not(.sun)")].slice(0, plan.decided).forEach((li, i) => {
      const icon = li.querySelector("b"), chance = li.querySelector("small");
      if (ro.hours[i]) { if (!/🌧|⛈/u.test(icon.textContent)) icon.textContent = "🌧️"; return; }
      chance.textContent = "";
      if (/🌧|🌦|⛈/u.test(icon.textContent) && !(i === 0 && plan.keepNow)) icon.textContent = "☁️";
    });
  } catch (e) {
    box.textContent = words.unavailable;
  }
});
</script>` : ""}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
// A township typed in a widget's Parameter field, or from a link: "臺南市東區", or a township name found only
// once in Taiwan (with or without its 鄉/鎮/市/區).
function findPlace(text) {
  const q = String(text || "").replace(/\s+/g, "").replace(/台/g, "臺");
  if (!q) return null;
  const exact = TOWN_POINTS.find((t) => t.county + t.name === q);
  if (exact) return exact;
  const named = TOWN_POINTS.filter((t) => t.name === q || t.name.slice(0, -1) === q);
  return named.length === 1 ? named[0] : null;
}

async function askKey(message) {
  const a = new Alert();
  a.title = T().keyTitle;
  a.message = message;
  a.addTextField("CWA-XXXXXXXX-...");
  a.addAction(T().save);
  a.addCancelAction(T().skip);
  if ((await a.present()) === -1) return null;
  const key = a.textFieldValue(0).trim();
  if (key) Keychain.set(KEYCHAIN_KEY, key);
  return key || null;
}

async function ensureKey() {
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (config.runsInWidget) return null;
  return askKey(T().keyPrompt);
}

async function main() {
  sharedDownloads.clear(); // each run of the script downloads afresh
  const settings = await loadSettings();
  setLang(settings.lang);
  const family = config.widgetFamily || "medium";
  // A widget's Parameter (or a pinned widget's tap, ?place=…) picks a saved place instead of the phone's location.
  const asked = args.widgetParameter || (args.queryParameters && args.queryParameters.place) || "";
  const pinned = findPlace(asked);
  if (config.runsInApp) {
    if (asked && !pinned) throw new Error(T().unknownPlace(asked));
    return showApp(await ensureKey(), settings, pinned);
  }
  let result;
  try {
    if (asked && !pinned) throw new Error(T().unknownPlace(asked));
    result = await run(await ensureKey(), { place: pinned, settings });
  } catch (e) {
    const w = new ListWidget();
    w.addText(T().weatherError + e.message);
    if (config.runsInWidget) { Script.setWidget(w); return; }
    throw e;
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(buildWidget(result, family));
    if (settings.notifyTest) { // armed by "Send a test" in the full view
      await sendNotification("test", T().testTitle, T().testBodyWidget);
      settings.notifyTest = false;
      saveSettings(settings);
    }
  } else {
    await buildWidget(result, family).presentMedium();
  }
}

// The forecast last saved for a place, from this hour on, to show while a new one loads (null if there's none
// left). Radar frames, the next hour and old errors are left out; the station's reading only if under an hour old.
async function savedForecast(place) {
  const state = await storage(place).load(), last = state && state.lastResult;
  const nowKey = hourKey(new Date()), rows = last && last.rows ? last.rows.filter((h) => h.key >= nowKey) : [];
  if (rows.length < 12) return null;
  const today = nowKey.slice(0, 10), tomorrow = addHours(today + "T00", 24).slice(0, 10);
  return { ...last, rows, updating: true, stale: false, errors: [], frames: null, rainRadarTimes: {}, rainFrames: null,
    radar: last.radar && { ...last.radar, time: null }, // its image is always the latest: no old time on it
    station: Date.now() - Date.parse(last.updated) < HOUR ? last.station : null,
    warnings: stillActive(last.warnings), days: (last.days || []).filter((d) => d.day >= today),
    sun: last.loc ? [today, tomorrow].map((day) => ({ day, ...sunTimes(day, last.loc) })) : last.sun,
    moon: last.moon ? moonPhase(new Date()) : null };
}

// The place's name on a plain page: while its first forecast loads, or with a Try again link if it couldn't.
function placeholderHTML(name, note, retry) {
  return `<html lang="${LANG === "zh" ? "zh-Hant-TW" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 6px; padding: 0 24px; text-align: center;
  color: #fff; font: 17px/1.35 -apple-system, system-ui, sans-serif; background: linear-gradient(#2f6fd0, #5aa9e6) fixed; }
p { margin: 0; } .place { font-size: 28px; } a { color: #fff; }
</style></head><body><p class="place">${esc(name)}</p><p>${esc(note)}</p>` +
    (retry != null ? `<p><a href="tw-weather://show?place=${retry}">${T().tryAgain}</a></p>` : "") + `</body></html>`;
}

// The full view. It opens at once, on the forecast last saved for the place (marked "Updating…"), and redraws
// when the new one is in; swiping to a place that isn't loaded yet works the same way after a second. Its links
// to tw-weather://… come here, one at a time, and the page is redrawn.
async function showApp(key, settings, pinned) {
  const wv = new WebView();
  let current = "here", enter = "", result = null, failure = null, shows = 0, timing = null;
  if (pinned) { // a widget pinned to a place: open on it, saving it if it isn't yet
    current = settings.places.findIndex((p) => p.county === pinned.county && p.name === pinned.name);
    if (current < 0) current = settings.places.push({ county: pinned.county, name: pinned.name }) - 1;
    saveSettings(settings);
  }
  // Forecasts by place (and key), so swiping back and forth is instant; each is refetched after 10 minutes.
  const placeOf = (i) => (i === "here" ? null : findPlace(settings.places[i].county + settings.places[i].name));
  const nameOf = (p) => (p ? p.county + p.name : "here") + "|" + key;
  const cache = new Map(), loading = new Map();
  const forecast = (p) => {
    const name = nameOf(p), hit = cache.get(name);
    if (hit && Date.now() - hit.at < 10 * 60e3) return Promise.resolve(hit.result);
    if (!loading.has(name)) {
      loading.set(name, run(key, { place: p, settings })
        .then((r) => { cache.set(name, { result: r, at: Date.now() }); return r; })
        .finally(() => loading.delete(name)));
    }
    return loading.get(name);
  };
  // Fetch the places on either side, so the next swipe needn't wait.
  const prefetchNeighbours = () => {
    const order = ["here", ...settings.places.map((_, i) => i)], at = order.indexOf(current);
    for (const i of [order[at + 1], order[at - 1]]) if (i !== undefined) forecast(placeOf(i)).catch(() => {});
  };
  const draw = async (ui = {}) => {
    const name = current === "here" ? T().here : settings.places[current].county + settings.places[current].name;
    const page = result ? detailHTML(result, { settings, current, enter, timing, ...ui })
      : failure ? placeholderHTML(name, T().loadFailed + " " + failure.message, current) : placeholderHTML(name, T().loading);
    enter = "";
    // a page whose map or fonts are slow to load mustn't hold up the next swipe
    await within(wv.loadHTML(page, CWA_SITE), CONFIG.pageWaitMs);
  };
  let queue = Promise.resolve();
  const enqueue = (task) => (queue = queue.then(task).catch(() => draw()).catch(() => {}));
  // Redraw with what just came in, kept where it was scrolled to. Not while that would get in the way (a finger
  // on the screen, the place search, the 降雨雷達 tab or the animation open): then try again in 2 s, for up to a minute.
  const redraw = async (ticket, tries = 0) => {
    if (ticket !== shows) return;
    let page = { y: 0, busy: false };
    try {
      page = JSON.parse(await within(wv.evaluateJavaScript("JSON.stringify(window.pageState ? pageState() : { y: 0, busy: false })"), 1000)) || page;
    } catch (e) { /* a plain page */ }
    if (page.busy && tries < 30) {
      Timer.schedule(CONFIG.redrawRetryMs, false, () => enqueue(() => redraw(ticket, tries + 1)));
      return;
    }
    await draw({ scrollY: page.y });
  };
  // When the new forecast arrives, show it, unless another place has been chosen since. If it fails, the saved one
  // stays, marked as old, or the place's page says so.
  const whenIn = (ticket, pending) => pending.then(
    (r) => enqueue(() => { if (ticket !== shows) return; result = r; failure = null; return redraw(ticket); }),
    (e) => enqueue(() => {
      if (ticket !== shows) return;
      if (result) result = { ...result, updating: false, stale: true, errors: [e.message] };
      else failure = e;
      return draw();
    }));
  const show = async (i, dir = "") => {
    const ticket = ++shows, p = placeOf(i), pending = forecast(p);
    current = i; enter = dir; failure = null;
    prefetchNeighbours();
    const t0 = Date.now(), fresh = await within(pending, CONFIG.swipeWaitMs), t1 = Date.now();
    result = fresh || (await savedForecast(p));
    await draw();
    // how long this switch took, shown small at the bottom of the next page, to tell where a slow one waited
    timing = { forecast: t1 - t0, page: Date.now() - t1, saved: !fresh };
    if (!fresh) whenIn(ticket, pending);
  };
  const handle = async (action, params) => {
    if (action === "show") return show(settings.places[Number(params.place)] ? Number(params.place) : "here", params.dir || "");
    if (action === "add") {
      const t = findPlace(params.place);
      if (!t) return draw();
      let i = settings.places.findIndex((p) => p.county === t.county && p.name === t.name);
      if (i < 0) i = settings.places.push({ county: t.county, name: t.name }) - 1;
      saveSettings(settings);
      return show(i);
    }
    if (action === "remove") {
      const [gone] = settings.places.splice(Number(params.place), 1);
      if (gone) cache.delete(nameOf(gone));
      saveSettings(settings);
      return show("here");
    }
    if (action === "lang") { settings.lang = params.to; setLang(params.to); }
    if (action === "notify") for (const k of Object.keys(params)) settings.notify[k] = params[k] === "1";
    if (action === "test") {
      await sendNotification("test", T().testTitle, T().testBodyApp);
      settings.notifyTest = true;
    }
    saveSettings(settings);
    return draw();
  };
  wv.shouldAllowRequest = (request) => {
    const url = String(request.url);
    if (!url.startsWith("tw-weather://")) return true;
    const [action, query = ""] = url.slice("tw-weather://".length).split("?");
    const params = Object.fromEntries(query.split("&").filter(Boolean).map((kv) => kv.split("=").map(decodeURIComponent)));
    enqueue(() => handle(action, params));
    return false;
  };

  // Open at once on what there is, then fetch.
  const ticket = ++shows, first = placeOf(current);
  result = await savedForecast(first);
  await draw();
  const presented = wv.present(true);
  prefetchNeighbours();
  let fresh = forecast(first);
  // CWA answered with an error (most likely a mistyped key): offer to replace the saved key.
  const answer = await fresh.catch(() => null);
  const rejected = key && answer && answer.errors.find((e) => e.startsWith("CWA stations:"));
  if (rejected) {
    const newKey = await askKey(T().keyRejected(rejected));
    if (newKey) {
      key = newKey;
      fresh = forecast(first).catch(() => answer);
      prefetchNeighbours();
    }
  }
  await whenIn(ticket, fresh);
  // While the page is open, the place shown is refreshed every few minutes (a forecast is kept 10 minutes).
  const refresher = Timer.schedule(CONFIG.refreshMinutes * 30e3, true, () => enqueue(async () => {
    const t = shows, r = await within(forecast(placeOf(current)), 30e3);
    if (r && r !== result && t === shows) { result = r; failure = null; await redraw(t); }
  }));
  await queue;
  await presented;
  refresher.invalidate();
}

// __TEST__ is only defined by test/harness.mjs
if (typeof __TEST__ === "undefined") {
  await main();
  Script.complete();
}
