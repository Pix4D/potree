import { Observable } from 'rxjs/Observable';
import { filter } from 'rxjs/operators';

/**
 * Filters the observable until the value is not null or undefined.
 */
export function notNil<T>() {
  return (o: Observable<T | null | undefined>): Observable<T> => {
    return o.pipe(filter(v => !isNil(v))) as Observable<T>;
  };
}

/**
 * Filters the observable until the value is null or undefined.
 */
export function nil<T>() {
  return (o: Observable<T | null | undefined>): Observable<null | undefined> => {
    return o.pipe(filter(isNil));
  };
}

function isNil(v: any) {
  return v === null || v === undefined;
}
