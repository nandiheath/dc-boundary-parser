# DC-Boundary-Parser

## Run

This will download the pdf files from 2007 to 2019, and save them in `raw/pdf`
The output will be at `output`

```bash
npm install

node run.js
```

## Known Issues

- [ ] year 2003 cannot be parsed. no return from the library
  - reason is pdfs in 2003 are encoded in big5, and the pdf library cannot decode it
- [ ] some population/deviation cannot be parsed
- [ ] some data cannot be parsed correctly
  - [ ] 2015R shatin