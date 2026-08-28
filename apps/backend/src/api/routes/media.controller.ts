import {
  ForbiddenException,
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';

// toybaco_memory_upload_boundary_v1: multerがbufferを確保する前に止める。
const toybacoMemoryUploadOptions = {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 100,
    fieldSize: 1024,
    headerPairs: 64,
  },
  fileFilter: (_req: any, file: any, callback: any) => {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file?.mimetype)) {
      callback(new BadRequestException('メディアをアップロードできませんでした'), false);
      return;
    }
    callback(null, true);
  },
};

@Catch()
class ToybacoUploadExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = exception?.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge
      ? 413
      : exception instanceof HttpException && exception.getStatus() < 500
        ? exception.getStatus()
        : 500;
    response.status(status).json({
      code: tooLarge ? 'UPLOAD_TOO_LARGE' : status >= 500 ? 'UPLOAD_FAILED' : 'UPLOAD_INVALID_FILE',
      message: tooLarge
        ? 'この経路では10MB以下の画像だけアップロードできます'
        : 'メディアをアップロードできませんでした',
    });
  }
}

function toybacoRejectMediaGeneration(): void {
  throw new ForbiddenException('この機能は利用できません');
}

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService
  ) {}

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    console.log('hello');
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      return false;
    }

    return {
      output:
        'data:image/png;base64,' +
        (await this._mediaService.generateImage(prompt, org, isPicturePrompt)),
    };
  }

  @Post('/generate-image-with-prompt')
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string
  ) {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    const image = await this.generateImage(org, req, prompt, true);
    if (!image) {
      return false;
    }

    const file = await this.storage.uploadSimple(
      (image as { output: string }).output
    );

    return this._mediaService.saveFile(org.id, file.split('/').pop(), file);
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file', toybacoMemoryUploadOptions))
  @UseFilters(new ToybacoUploadExceptionFilter())
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName
    );
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file', toybacoMemoryUploadOptions))
  @UseFilters(new ToybacoUploadExceptionFilter())
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName
    );
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload = await handleR2Upload(endpoint, org.id, req, res);
    if (res.headersSent || endpoint !== 'complete-multipart-upload') {
      return upload;
    }
    const completed = upload as any;
    if (
      !completed ||
      typeof completed.Location !== 'string' ||
      typeof completed.Key !== 'string' ||
      typeof completed.OriginalName !== 'string'
    ) {
      return res.status(502).json({
        code: 'UPLOAD_STORAGE_ERROR',
        message: 'メディアを確定できませんでした',
      });
    }
    const saveFile = await this._mediaService.saveFile(
      org.id,
      completed.Key,
      completed.Location,
      completed.OriginalName
    );

    res.status(200).json({
      Location: completed.Location,
      Key: completed.Key,
      ETag: completed.ETag,
      saved: saveFile,
    });
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number,
    @Query('search') search?: string
  ) {
    return this._mediaService.getMedia(org.id, page, search);
  }

  @Get('/video-options')
  getVideos() {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  videoFunction(
    @Body() body: VideoFunctionDto
  ) {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    return this._mediaService.videoFunction(body.identifier, body.functionName, body.params);
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    // 画像・動画の生成は提供しない。顧客が投稿するのは実際の商品・施術・
    // 物件の写真であり、AI で作った画像を使うと誤認表示になりかねない。
    // toybaco_ai_media_permanent_block: 製品判断なので設定値に関係なく閉じる。
    toybacoRejectMediaGeneration();
    return this._mediaService.generateVideoAllowed(org, type);
  }
}
