import { Archive, BadgeCheck, CarFront, Clock3, Eye, Pencil, Wrench } from 'lucide-react';
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
  workflow_stage: string;
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
  onMarkSold,
  onWorkflowChange,
}: {
  vehicle: VehicleCardRecord;
  imageUrl?: string;
  categoryLabel: string;
  formatMoney: (value: number) => string;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onMarkSold: () => void;
  onWorkflowChange: (stage: string) => void;
}) {
  const stagePresentation: Record<string, { label: string; Icon: typeof Clock3 }> = {
    processing: { label: 'Processing', Icon: Clock3 },
    repairing: { label: 'Repairing', Icon: Wrench },
    ready_to_sell: { label: 'Ready to sell', Icon: BadgeCheck },
    reserved: { label: 'Reserved', Icon: Clock3 },
    sold: { label: 'Sold', Icon: BadgeCheck },
    archived: { label: 'Archived', Icon: Archive },
  };
  const stage = stagePresentation[vehicle.workflow_stage] ?? stagePresentation.ready_to_sell;
  const StageIcon = stage.Icon;

  return (
    <article className="vehicle-card glass-panel">
      <Link className="vehicle-card-photo-link" to={`/inventory/${vehicle.id}`} aria-label={`View ${vehicle.make} ${vehicle.model}`}>
        <div className={`vehicle-card-photo${imageUrl ? '' : ' vehicle-card-photo-empty'}`}>
          {imageUrl
            ? <img src={imageUrl} alt={`${vehicle.manufacturing_year ?? ''} ${vehicle.make} ${vehicle.model}`} loading="lazy" />
            : <CarFront size={42} strokeWidth={1.3} aria-hidden="true" />}
          <span className={`vehicle-card-status status-${vehicle.workflow_stage.replace(/[^a-z0-9]+/g, '-')}`}>
            <StageIcon size={13} aria-hidden="true" /> {stage.label}
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
          {vehicle.business_category !== 'consignment' && <div><dt>Purchase price</dt><dd>{vehicle.purchase_price === null ? 'Not recorded' : formatMoney(vehicle.purchase_price)}</dd></div>}
          <div><dt>{vehicle.business_category === 'consignment' ? 'Customer minimum' : 'Demand'}</dt><dd>{vehicle.expected_sale_price === null ? 'Not recorded' : formatMoney(vehicle.expected_sale_price)}</dd></div>
          <div><dt>In inventory</dt><dd>{vehicle.inventoryAgeDays == null ? 'Purchase date not recorded' : `${vehicle.inventoryAgeDays} days`}</dd></div>
        </dl>
        <div className="vehicle-card-actions">
          <Link className="vehicle-card-details" to={`/inventory/${vehicle.id}`}><Eye size={16} /> View profile</Link>
          {canManage && (
            <div className="vehicle-card-admin-actions">
              <button type="button" className="icon-button" aria-label={`Edit ${vehicle.make} ${vehicle.model}`} onClick={onEdit}><Pencil size={16} /></button>
              {vehicle.workflow_stage !== 'sold' && vehicle.workflow_stage !== 'archived' && (
                <select
                  className="vehicle-card-stage-select"
                  aria-label={`Update status for ${vehicle.make} ${vehicle.model}`}
                  value={vehicle.workflow_stage}
                  onChange={(event) => onWorkflowChange(event.target.value)}
                >
                  <option value="processing">Processing</option>
                  <option value="repairing">Repairing</option>
                  <option value="ready_to_sell">Ready to sell</option>
                  <option value="reserved">Reserved</option>
                </select>
              )}
              {vehicle.workflow_stage === 'ready_to_sell' && <button type="button" className="text-button vehicle-card-sell-button" onClick={onMarkSold}>Mark as sold</button>}
              {vehicle.status !== 'archived' && <button type="button" className="icon-button" aria-label={`Archive ${vehicle.make} ${vehicle.model}`} onClick={onArchive}><Archive size={16} /></button>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
