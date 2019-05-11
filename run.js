let fs = require('fs'),
  PDFParser = require("pdf2json");
const Promise = require('bluebird');
const request = Promise.promisifyAll(require('request'));

const mkdirp = require('mkdirp');
const BOUNDARY_KEYS = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
const debug = false;

const DISTRICT_CODE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T']
const DISTRICT_CODE_2003 = ['cnw', 'wc', 'east', 'south', 'ytm', 'ssp', 'kc', 'wts', 'kt', 'tw', 'tm', 'yl', 'north', 'tp',
  'sk', 'st', 'kwaitsing', 'islands'];
const YEARS = [2007, 2011, 2015, 2019];

async function run() {
  console.log('Start to download the pdfs');
  for (const year of YEARS) {
    for (const code of DISTRICT_CODE) {
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

run().then().catch(err => {
  console.error(err);
});

function getPdfPath(year, code) {
  switch (year) {
    case 2003: return `https://www.eac.hk/pdf/distco/ch/2003dc_boundary/v2_${DISTRICT_CODE_2003[DISTRICT_CODE.indexOf(code)]}_c.pdf`;
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

function getLocalStoragePdfPath(year, code) {
  mkdirp.sync(`raw/pdf`);
  return `raw/pdf/${year}_${code}.pdf`;
}

async function downloadAndParseData(year, code) {
  return new Promise((resolve, reject) => {
    const path = getPdfPath(year, code);
    const filePath = getLocalStoragePdfPath(year, code);
    request
      .get(path)
      .pipe(fs.createWriteStream(filePath, {
        flags: 'w+',
        encoding: 'utf8'
      }))
      .on('error', (err) => {
        console.log(err);
        reject(err);
      })
      .on('close', () => {
        // pdf is downloaded
        const pdfParser = new PDFParser(this);
        pdfParser.on("pdfParser_dataError", errData => {
          console.error(errData);
          reject(errData);
        });
        pdfParser.on("pdfParser_dataReady", pdfData => {
          const pages = pdfData.formImage.Pages;
          const formattedData = parsePages(pages);

          saveToFile(year, code, formattedData);
          resolve();
        });

        pdfParser.loadPDF(filePath);
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

function parsePopulationAndPercentage(row) {
  let expectedPopulation = 0, deviationPercentage = 0;
  // Join all the text and use regex to dig the population and percentage
  const text = row.filter((_, index) => index >= 2).join('');
  if (text !== null) {
    const matches = text.match(/[+-]{0,1}\d*[\,\.]?\d+%?/g)
    if (matches && matches.length >= 1) {
      expectedPopulation = matches[0];
    }
    if (matches && matches.length >= 2) {
      deviationPercentage = matches[1];
    }
  }


  return {
    expectedPopulation, deviationPercentage
  };
}

function processRows(rows) {
  const results = [];
  let districtData = null;
  for (const row of rows) {
    const [key] = row;
    if (key.match(/\w(\d){2}/)) {
      const {
        expectedPopulation, deviationPercentage
      } = parsePopulationAndPercentage(row);
      // We found the key and progress
      districtData = {};
      districtData.code = key.trim();
      districtData.name = row[1];
      districtData.expectedPopulation = expectedPopulation;
      districtData.deviationPercentage = deviationPercentage;
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