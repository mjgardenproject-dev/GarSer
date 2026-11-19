// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gardener/PhytosanitaryLicenseUpload', () => ({
  default: ({ onSubmitted }: { onSubmitted?: () => void }) => <button type="button" onClick={onSubmitted}>enviar carnet</button>,
}));
vi.mock('../gardener/PhytosanitaryPricingConfigurator', () => ({ default: () => <div>configurador</div> }));

import PhytoStep from './PhytoStep';
import { SETUP_CHANGED_EVENT } from '../../utils/setupEvents';

describe('PhytoStep · QA-202', () => {
  afterEach(() => cleanup());

  it('al enviar el carnet avisa de que cambió la cuenta, para que el bloque «sube tu carnet» se actualice', () => {
    const changed = vi.fn();
    window.addEventListener(SETUP_CHANGED_EVENT, changed);
    render(<PhytoStep savedConfig={undefined} licenseStatus={null} onSave={async () => true} registerSave={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'enviar carnet' }));
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(SETUP_CHANGED_EVENT, changed);
  });
});
