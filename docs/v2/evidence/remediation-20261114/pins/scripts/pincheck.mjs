const { assertReviewedInputPins, REVIEWED_INPUT_PINS } = await import(process.argv[2]);
console.log('pinned files:', Object.keys(REVIEWED_INPUT_PINS).join(', '));
try { assertReviewedInputPins(); console.log('assertReviewedInputPins: PASS (all pins match)'); }
catch (e) { console.log('assertReviewedInputPins: REFUSED:', String(e.message).slice(0, 300)); process.exitCode = 1; }
