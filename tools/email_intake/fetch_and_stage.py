import sys
LEGACY_RETIRED_V2 = 'AFLDB_LEGACY_RETIRED_V2: email intake is retired; offline evidence is under legacy/offline/tools/email_intake/'
if __name__ == "__main__":
    print(LEGACY_RETIRED_V2, file=sys.stderr)
    sys.exit(1)
