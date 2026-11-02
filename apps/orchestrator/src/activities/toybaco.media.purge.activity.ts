import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ToybacoMediaPurgeCursor } from '@gitroom/nestjs-libraries/toybaco/media-purge';
import {
  toybacoMediaS3Store,
  toybacoPurgeDeletedMedia,
} from '@gitroom/nestjs-libraries/toybaco/media-purge.service';

// toybaco_media_purge_v1: workflow から位置(削除時刻と id)だけを受け取り、件数だけを返す。key や URL は履歴に載せない。
@Injectable()
@Activity()
export class ToybacoMediaPurgeActivity {
  constructor(private _prisma: PrismaService) {}

  @ActivityMethod()
  async toybacoPurgeDeletedMediaV1(cursor: ToybacoMediaPurgeCursor | null) {
    return toybacoPurgeDeletedMedia({
      prisma: this._prisma,
      store: toybacoMediaS3Store(process.env),
      env: process.env,
      nowMs: Date.now(),
      cursor,
      models: Prisma.dmmf?.datamodel?.models as never,
    });
  }
}
