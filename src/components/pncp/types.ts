import type { CompanyProfile, BiddingProcess } from '../../types';
import type { usePncpPage } from '../hooks/usePncpPage';

export interface PncpChildProps {
    p: ReturnType<typeof usePncpPage>;
    companies: CompanyProfile[];
    items: BiddingProcess[];
}
