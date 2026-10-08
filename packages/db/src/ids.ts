import { v7 } from "uuid";

/** Time-sortable UUID v7 primary key. */
export function newId(): string {
  return v7();
}
