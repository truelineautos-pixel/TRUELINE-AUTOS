import { CarFront, Eye, Pencil, Archive } from 'lucide-react';
import { Link } from 'react-router-dom';

type VehicleCardRecord = {
  id: string;
  business_category: string;
  make: string;
  model: string;
  variant: string | null;
  manufacturing_year: number | null;
  registration_number: string | null;
  status: string;
  purchase_date: string | null;
  purchase_price: number | null;
  expected_sale_price: number | null;
  inventoryAgeDays?: number | null;
};

export default function VehicleCard({
  vehicle,
  imageUrl,
  categoryLabel,
  formatMoney,
  canManage,
  onEdit,
  onArchive,
}: {
  vehicle: VehicleCardRecord;
  imageUrl?: string;
  categoryLabel: string;
  formatMoney: (value: number) => string;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <article className="vehicle-card glass-panel">
      <Link className="vehicle-card-photo-link" to={`/inventory/${vehicle.id}`} aria-label={`View ${vehicle.make} ${vehicle.model}`}>
        <div className={`vehicle-card-photo${imageUrl ? '' : ' vehicle-card-photo-empty'}`}>
          {imageUrl
            ? <img src={imageUrl} alt={`${vehicle.manufacturing_year ?? ''} ${vehicle.make} ${vehicle.model}`} loading="lazy" />
            : <CarFront size={42} strokeWidth={1.3} aria-hidden="true" />}
          <span className={`vehicle-card-status status-${vehicle.status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            {vehicle.status.replaceAll('_', ' ')}
          </span>
        </div>
      </Link>
      <div className="vehicle-card-body">
        <div className="vehicle-card-title-row">
          <div className="vehicle-card-title">
            <p className="eyebrow">{vehicle.manufacturing_year ?? 'Year not recorded'}</p>
            <h3>{vehicle.make} {vehicle.model}</h3>
            {vehicle.variant && <p className="muted">{vehicle.variant}</p>}
          </div>
          <span className="vehicle-card-category">{categoryLabel}</span>
        </div>
        <dl className="vehicle-card-facts">
          <div><dt>Registration</dt><dd>{vehicle.registration_number || 'Not recorded'}</dd></div>
          <div><dt>Purchase price</dt><dd>{vehicle.purchase_price === null ? 'Not recorded' : formatMoney(vehicle.purchase_price)}</dd></div>
          <div><dt>Expected sale</dt><dd>{vehicle.expected_sale_price === null ? 'Not recorded' : formatMoney(vehicle.expected_sale_price)}</dd></div>
          <div><dt>In inventory</dt><dd>{vehicle.inventoryAgeDays == null ? 'Purchase date not recorded' : `${vehicle.inventoryAgeDays} days`}</dd></div>
        </dl>
        <div className="vehicle-card-actions">
          <Link className="vehicle-card-details" to={`/inventory/${vehicle.id}`}><Eye size={16} /> View profile</Link>
          {canManage && (
            <div className="vehicle-card-admin-actions">
              <button type="button" className="icon-button" aria-label={`Edit ${vehicle.make} ${vehicle.model}`} onClick={onEdit}><Pencil size={16} /></button>
              {vehicle.status !== 'archived' && <button type="button" className="icon-button" aria-label={`Archive ${vehicle.make} ${vehicle.model}`} onClick={onArchive}><Archive size={16} /></button>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
