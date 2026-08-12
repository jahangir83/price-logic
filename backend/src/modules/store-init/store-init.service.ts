import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InitializationStatus, Shop } from '../shops/entities/shop.entity';
import { UpdateDefaultSettingsDto } from './dto/update-default-settings.dto';

@Injectable()
export class StoreInitService {
  private readonly logger = new Logger(StoreInitService.name);

  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
  ) {}

  /**
   * Runs once per install, right after authentication succeeds. Idempotent:
   * re-running on an already-initializing/initialized shop is a no-op.
   */
  async initialize(shop: Shop): Promise<Shop> {
    if (shop.initializationStatus !== InitializationStatus.NOT_STARTED) {
      return shop;
    }

    shop.initializationStatus = InitializationStatus.IN_PROGRESS;
    const saved = await this.shopRepository.save(shop);
    this.kickOffProductSync(saved);
    return saved;
  }

  /**
   * Product/variant sync is fully implemented in Phase 3. This stub only
   * marks that initialization is underway so the setup wizard has something
   * to show progress against; Phase 3 wires in the real Shopify fetch job.
   */
  private kickOffProductSync(shop: Shop): void {
    this.logger.log(
      `Product sync requested for shop ${shop.id} (stub — implemented in Phase 3)`,
    );
  }

  async updateDefaultSettings(
    shopId: string,
    dto: UpdateDefaultSettingsDto,
  ): Promise<Shop> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    shop.defaultSettings = { ...shop.defaultSettings, ...dto };
    return this.shopRepository.save(shop);
  }

  /**
   * Marks setup complete. Per the setup-wizard spec, a merchant may
   * complete or skip any step — this does not require every default
   * setting to be populated, since all of them remain editable later.
   */
  async completeSetup(shopId: string): Promise<Shop> {
    const shop = await this.shopRepository.findOneByOrFail({ id: shopId });
    shop.initializationStatus = InitializationStatus.COMPLETE;
    return this.shopRepository.save(shop);
  }
}
