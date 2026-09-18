(function () {
  var f = new File('/Users/dadam/Documents/ScanR/TypeR-silicon/validation/native-probe-result.json');
  f.encoding = 'UTF8';
  if (f.open('w')) {
    f.write('{"version":' + '"' + app.version + '","os":"' + $.os + '","documents":' + app.documents.length + '}');
    f.close();
  }
})();
