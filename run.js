let fs = require('fs'),
  PDFParser = require("pdf2json");
const Promise = require('bluebird');
const request = Promise.promisifyAll(require('request'));

const mkdirp = require('mkdirp');
const BOUNDARY_KEYS = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
const debug = false;

const DISTRCIT_CODE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T']
const DISTRCIT_CODE_2003 = ['cnw', 'wc', 'east', 'south', 'ytm', 'ssp', 'kc', 'wts', 'kt', 'tw', 'tm', 'yl', 'north', 'tp',
'sk', 'st', 'kwaitsing', 'islands'];
const YEARS = ['2003', '2007', '2011', '2015', '2019'];
const DOWNLOAD_FILE_PATH = 'tmp.pdf';

async function run() {

  for (const year of YEARS) {
    for (const code of DISTRCIT_CODE) {
      try {
        await downloadAndParseData(year, code);
        console.log(`Finsihed process ${year}_${code}`);
      } catch (error) {
        console.error(`Cannot process ${year}_${code}.`);
        console.error(error);
      }

    }
  }

}

run().then();

function getPdfPath(year, code) {
  switch (year) {
    case 2003: return `https://www.eac.hk/pdf/distco/ch/2003dc_boundary/v2_${DISTRCIT_CODE_2013[DISTRCIT_CODE.indexOf(code)]}_c.pdf`;
    case 2007: return `https://www.eac.hk/pdf/distco/2007dc/ch/${code}_descriptions.pdf`;
    case 2011: return `https://www.eac.hk/pdf/distco/2011dc/ch/${code}_descriptions.pdf`;
    case 2015: return `https://www.eac.hk/pdf/distco/2015dc/final/ch/${code}_descriptions.pdf`;
    case 2019: return `https://www.eac.hk/pdf/distco/2019dc/final/ch/${code}_descriptions(Chi).pdf`;
  }
}

function saveToFile(year, code, data) {
  mkdirp.sync(`output/${year}`);
  fs.writeFileSync(`output/${year}/${code}.json`, decodeURIComponent(JSON.stringify(data, null, 2)));
}

async function downloadAndParseData(year, code) {
  return new Promise((resolve, reject) => {
    request
      .get(`https://www.eac.hk/pdf/distco/2015dc/final/ch/${code}_descriptions.pdf`)
      .pipe(fs.createWriteStream(DOWNLOAD_FILE_PATH))
      .on('close', () => {
        // pdf is downloaded

        let pdfParser = new PDFParser();
        pdfParser.on("pdfParser_dataError", errData => {
          reject(errData);
        });
        pdfParser.on("pdfParser_dataReady", pdfData => {
          const pages = pdfData.formImage.Pages;
          const formattedData = parsePages(pages);
          saveToFile(year, code, formattedData);
          resolve();
        });

        pdfParser.loadPDF(DOWNLOAD_FILE_PATH);
      })
  })
}


const THRESHOLD = 1.0;

function parsePages(pages) {
  const rows = [];
  for (const page of pages) {
    const texts = page.Texts;
    let row = [];
    let lastY = 0;
    for (const text of texts) {
      // drop all the headers
      if (text.y < 7) {
        continue;
      }
      const str = text.R.map(r => decodeURIComponent(r.T)).join('');
      if (Math.abs(text.y - lastY) > THRESHOLD) {
        if (row.length > 0) {
          rows.push(row);
        }
        row = [];
      }
      if (debug) {
        console.log(`${text.x}, ${text.y}, ${text.R.map(r => decodeURIComponent(r.T)).join('')}`)
      }
      lastY = text.y;
      row.push(str);
    }
    if (row.length > 0) {
      rows.push(row);
    }
  }

  return processRows(rows);
}

function processRows(rows) {
  const results = [];
  let districtData = null;
  for (const row of rows) {
    const [key] = row;
    if (key.match(/\w(\d){2}/)) {
      // We found the key and progress
      districtData = {};
      districtData.code = key;
      districtData.name = row[1];
      districtData.expectedPopulation = row[2];
      districtData.deviationPercentage = row[3] + (row.length > 4 ? row[4] : '');
      districtData.bondaries = [];
      districtData.mainArea = [];
      results.push(districtData);
      continue;
    }
    if (districtData === null) {
      if (debug) {
        console.log(`weird data: ${row}`);
      }
      continue;
    }
    const { boundaries, mainArea } = parseRow(row);
    districtData.bondaries.push(...boundaries);
    districtData.mainArea.push(...mainArea);
  }
  return results;
}

function isAreaKey(str) {
  return str.match(/(\d){1,2}\./)
}
/**
 * Make the area object by the row
 * the row main contains
 * ['1.', '荷李活華庭']
 * or
 * [ '1.',
    '翠',
    '峰',
    '園',
    '2.',
    '樂信臺',
    '3.',
    '嘉兆臺',
    '4.',
    '麗豪閣',
    '東北',
    '下亞厘畢道、雲咸街' ],
 * @param {*} row
 */

const PARSING_MODE_BOUNDARY = 'boundray';
const PARSING_MODE_MAINAREA = 'area';

function parseRow(row) {
  if (debug) {
    console.log(row);
  }
  const boundaries = [];
  const mainArea = [];
  let parsingMode = null;
  let key = null;
  let value = '';
  function saveParsedObject() {
    if (value === '' || key === null) {
      return;
    }
    if (parsingMode === PARSING_MODE_BOUNDARY) {
      boundaries.push({
        [key]: value
      })
      value = '';
    } else if (parsingMode === PARSING_MODE_MAINAREA) {
      mainArea.push({
        [key]: value
      })
      value = '';
    }
  }
  for (let i = 0; i < row.length; i++) {
    const col = row[i];
    if (BOUNDARY_KEYS.indexOf(col) === -1) {
      if (isAreaKey(col)) {
        saveParsedObject();
        parsingMode = PARSING_MODE_MAINAREA;
        key = col;
      } else {
        value += col;
      }
    } else {
      saveParsedObject();
      parsingMode = PARSING_MODE_BOUNDARY;
      key = col;
    }
  }
  saveParsedObject();
  return {
    boundaries, mainArea
  };
}

function makeMainArea(row) {

}