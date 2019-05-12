let fs = require('fs'),
  PDFParser = require("pdf2json");

let pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", errData => {
  console.error(errData.parserError)
});

pdfParser.on("pdfParser_dataReady", pdfData => {
  const rows = [];
  const texts = pdfData.formImage.Pages[0].Texts;
  let row = [];
  let lastY = 0;
  for (const text of texts) {
    // drop all the headers
    if (text.y < 7) {
      continue;
    }
    const str = text.R.map(r => decodeURIComponent(r.T)).join('');
    if (Math.abs(text.y - lastY) > 1.0) {
      if (row.length > 0) {
        rows.push(row);
      }
      row = [];
    }

    lastY = text.y;
    row.push(str);
  }
  if (row.length > 0) {
    rows.push(row);
  }
  console.log(rows);
  fs.writeFileSync("output.json", JSON.stringify(pdfData, null, 2));
});

pdfParser.loadPDF("raw/pdf/2019_A.pdf");