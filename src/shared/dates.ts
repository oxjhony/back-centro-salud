import { DomainError } from './errors';

/**
 * DateRange del modelo: inicio y fin opcionales, fin no anterior al inicio (RNF-11).
 * Las fechas llegan como AAAA-MM-DD, comparables como texto.
 */
export function assertCoherentDates(start: string | null, end: string | null): void {
  if (start && end && end < start) {
    throw DomainError.invalid('fechas_incoherentes', 'La fecha final no puede ser anterior a la inicial.');
  }
}
