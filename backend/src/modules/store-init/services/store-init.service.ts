import { Injectable, Logger } from '@nestjs/common';
import { Shop } from '../../shops/entities/shop.entity';

/**
 * What happens to a shop the moment it is installed, beyond storing the token.
 *
 * Settings are no longer part of this. They are seeded when the shop row is
 * created and topped up when the settings screen is read, because setup became
 * optional and a shop has to be usable before the merchant has answered
 * anything. What is left here is the work install triggers.
 */
@Injectable()
export class StoreInitService {
  private readonly logger = new Logger(StoreInitService.name);

  /**
   * Runs once per install, right after authentication succeeds.
   *
   * Deliberately no longer keyed on `initializationStatus`. It used to skip
   * unless the shop was NOT_STARTED, which was correct while that column meant
   * "the merchant has not been through the wizard" — now that a new shop is
   * created already set up, the same guard would have skipped every install and
   * quietly stopped product sync from ever starting.
   */
  initialize(shop: Shop): Promise<Shop> {
    this.kickOffProductSync(shop);
    return Promise.resolve(shop);
  }

  /**
   * Product/variant sync is fully implemented in Phase 3. This stub only
   * records that sync was requested; Phase 3 wires in the real Shopify fetch
   * job.
   */
  private kickOffProductSync(shop: Shop): void {
    this.logger.log(
      `Product sync requested for shop ${shop.id} (stub — implemented in Phase 3)`,
    );
  }
}
