export function getArgument(argName: string) {
  let argVal: string;
  const argId = process.argv.indexOf(argName);

  if (argId > -1) {
    argVal = process.argv[argId + 1];
  }
  if (!argVal) {
    // tslint:disable-next-line: no-console
    console.log('No value found for ' + argName);
    argVal = undefined;
  }

  return argVal;
}
