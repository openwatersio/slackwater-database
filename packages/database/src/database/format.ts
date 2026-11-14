/**
 * The format major version this package writes and the newest it reads
 * (`Root.format_version` in schemas/database.fbs). Raise it only for a change
 * an older reader would misread, together with the Swift and Kotlin readers'.
 */
export const FORMAT_VERSION = 2;

/** The file is a station database in a newer format than this package reads. */
export class UnsupportedStationDatabaseError extends Error {
  constructor(readonly formatVersion: number) {
    super(
      `Unsupported station database: format version ${formatVersion}, this reader knows ${FORMAT_VERSION}. Upgrade @slackwater/database.`,
    );
    this.name = "UnsupportedStationDatabaseError";
  }
}
