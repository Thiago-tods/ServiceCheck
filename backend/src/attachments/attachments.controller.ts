import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentTenant, CurrentUser, TenantScoped } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/request-context';
import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  UploadedFile as UploadedFileType,
} from './attachments.service';

class UploadFields {
  @IsOptional() @IsUUID('4') id?: string;
  @IsOptional() @IsUUID() checklistItemId?: string;
}

@TenantScoped()
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('executions/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }),
  )
  upload(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @Body() fields: UploadFields,
  ) {
    return this.attachments.upload(t, u.userId, id, file, fields);
  }

  @Get('attachments/:id')
  async download(
    @CurrentTenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachments.download(t, id);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(file.body);
  }
}
